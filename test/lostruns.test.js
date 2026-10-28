// Runs left "running" by a process that is gone (D136), on throwaway projects with a fake `claude`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readyProject } from './sandbox.js';
import { processStart } from '../src/lostruns.js';

function run(p, { kind, startedAt = new Date().toISOString(), pid = null, leadPid = null }) {
  const d = p.writableDb();
  const id = Number(d.prepare("INSERT INTO runs (session_id, kind, started_at, status, pid, pid_started, lead_pid, lead_started) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)")
    .run(`s-${Math.random()}`, kind, startedAt, pid, pid ? processStart(pid) : null, leadPid, leadPid ? processStart(leadPid) : null).lastInsertRowid);
  d.close();
  return id;
}

function row(p, id) {
  const d = p.db();
  const r = d.prepare('SELECT status, reason, ended_at FROM runs WHERE id = ?').get(id);
  d.close();
  return r;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// A process that stands for a lead agent left running: the leader of its own group, like the runner starts it.
function orphan() {
  const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

test('a heartbeat whose runner died is closed by the next one, with an alert, and its lead agent is stopped', async () => {
  const p = readyProject();
  const log = join(p.root, 'notified.log');
  const lead = orphan();
  const lost = run(p, { kind: 'heartbeat', pid: 999999, leadPid: lead });
  p.runWith({ JEROME_NOTIFY_LOG: log }, 'heartbeat', 'demo');
  const r = row(p, lost);
  assert.equal(r.status, 'failed');
  assert.equal(r.reason, 'lost: the runner died, its lead agent stopped');
  assert.ok(r.ended_at);
  await new Promise((done) => setTimeout(done, 200));
  assert.ok(!alive(lead), 'the lead agent outliving its runner is stopped');
  // An alert, recorded; the heartbeat that found it ran on and ended well, which closes it, so nobody was called (D160).
  const { existsSync } = await import('node:fs');
  const d = p.db();
  assert.equal(d.prepare("SELECT status FROM alerts WHERE key = 'lost'").get().status, 'resolved');
  d.close();
  assert.ok(!existsSync(log));
  assert.equal(p.lastRun().status, 'done');
});

test('SessionStart closes interactive sessions whose process is gone, and a heartbeat whose runner is gone', () => {
  const p = readyProject();
  const gone = run(p, { kind: 'interactive', pid: 999999 });
  const here = run(p, { kind: 'interactive', pid: process.pid });
  const old = run(p, { kind: 'interactive', startedAt: new Date(Date.now() - 13 * 3_600_000).toISOString() });
  const recent = run(p, { kind: 'interactive', startedAt: new Date(Date.now() - 3_600_000).toISOString() });
  const heartbeat = run(p, { kind: 'heartbeat', pid: 999999 });
  const r = p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir, JEROME_CLAUDE_PID: String(process.pid) }, JSON.stringify({ cwd: p.dir, session_id: 'talk', source: 'startup' }), 'hook', 'session-start');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(row(p, gone).status, 'stopped');
  assert.equal(row(p, gone).reason, 'lost: the session ended without SessionEnd');
  assert.equal(row(p, old).status, 'stopped', 'no pid recorded: gone after 12 hours');
  assert.equal(row(p, here).status, 'running');
  assert.equal(row(p, recent).status, 'running');
  assert.equal(row(p, heartbeat).status, 'failed');
  // The new session records its own Claude Code process, and the alert reaches it first.
  const d = p.db();
  assert.equal(d.prepare("SELECT pid FROM runs WHERE session_id = 'talk'").get().pid, process.pid);
  d.close();
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /^Heartbeat alerts:[\s\S]*heartbeat of .* UTC lost: the runner died/);
});

test('a heartbeat still running long past its max duration is closed and its runner stopped', async () => {
  const p = readyProject();
  const runner = orphan();
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { lockPath } = await import('../src/runstate.js');
  // The lock as the hung runner holds it, under the sandbox's cache.
  const lock = join(p.root, '.cache', 'jerome', 'locks', lockPath(p.dir).split('/').pop());
  mkdirSync(join(lock, '..'), { recursive: true });
  writeFileSync(lock, String(runner));
  const hung = run(p, { kind: 'heartbeat', pid: runner, startedAt: new Date(Date.now() - 110 * 60_000).toISOString() });
  const fresh = run(p, { kind: 'interactive', pid: process.pid });
  p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir }, JSON.stringify({ cwd: p.dir, session_id: 'talk', source: 'startup' }), 'hook', 'session-start');
  assert.equal(row(p, hung).status, 'failed');
  assert.match(row(p, hung).reason, /^lost: still running 105 min after it started, over its max duration; runner stopped$/);
  assert.equal(row(p, fresh).status, 'running');
  await new Promise((done) => setTimeout(done, 200));
  assert.ok(!alive(runner));
});

test('the status line shows the alerts and requests waiting, and a heartbeat running (D137)', async () => {
  const p = readyProject();
  const line = () => p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir }, '{}', 'statusline').stdout.replace(/\x1b\[[\d;]*m/g, '').trim();
  assert.doesNotMatch(line(), /⚠|♥/);
  const d = p.writableDb();
  d.prepare("INSERT INTO alerts (key, reason, opened_at, last_at) VALUES ('k', 'r', '2026-10-28T08:00:00Z', '2026-10-28T08:00:00Z')").run();
  d.prepare("INSERT INTO requests (question, opened_at) VALUES ('Which?', '2026-10-28T08:00:00Z')").run();
  d.prepare("INSERT INTO requests (question, opened_at) VALUES ('And?', '2026-10-28T08:00:00Z')").run();
  d.close();
  assert.match(line(), /^⚠ 1 alert · 2 requests/);
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { lockPath } = await import('../src/runstate.js');
  const lock = join(p.root, '.cache', 'jerome', 'locks', lockPath(p.dir).split('/').pop());
  mkdirSync(join(lock, '..'), { recursive: true });
  writeFileSync(lock, String(process.pid));
  assert.match(line(), /♥ heartbeat running/);
});
