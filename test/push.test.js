// The push unlocked for one project (D194): `jerome rules`, the question on Telegram, and the push on the user's yes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readyProject } from './sandbox.js';
import { usersOnly } from '../src/blacklist.js';
import { leadPrompt } from '../src/heartbeat.js';

const CHAT = { id: 42, type: 'private', first_name: 'Fabio' };

function pushable() {
  const fake = join(process.env.XDG_CACHE_HOME ?? '/tmp', `telegram-push-${Math.random().toString(36).slice(2)}`);
  mkdirSync(fake, { recursive: true });
  const p = readyProject({ JEROME_TELEGRAM_FAKE: fake, JEROME_NOTIFY: 'off' });
  mkdirSync(join(p.root, '.config', 'jerome'), { recursive: true });
  writeFileSync(join(p.root, '.config', 'jerome', 'telegram.json'), JSON.stringify({ token: '1:x', chatId: CHAT.id, chat: 'Fabio', bot: 'jerome_test_bot' }));
  // A remote of its own, with main pushed once.
  const remote = join(p.root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  p.git('remote', 'add', 'origin', remote);
  p.git('push', '-q', 'origin', 'main');
  const remoteHead = () => execFileSync('git', ['rev-parse', 'main'], { cwd: remote, encoding: 'utf8' }).trim();
  const head = () => execFileSync('git', ['rev-parse', 'main'], { cwd: p.dir, encoding: 'utf8' }).trim();
  const commit = (name) => {
    writeFileSync(join(p.dir, `${name}.md`), `${name}\n`);
    p.git('add', `${name}.md`);
    p.git('commit', '-q', '-m', `Add ${name}`);
  };
  let update = 1;
  const receive = (...items) => writeFileSync(join(fake, 'updates.json'), JSON.stringify(items.map((x) => ({ update_id: update++, ...x }))));
  const tg = () => (existsSync(join(fake, 'calls.jsonl')) ? readFileSync(join(fake, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const idOf = (match) => {
    const calls = tg();
    let at = -1;
    calls.forEach((c, i) => { if (c.method === 'sendMessage' && match.test(c.params.text)) at = i; });
    assert.ok(at >= 0, `no message sent matches ${match}`);
    return { id: 1000 + at + 1, call: calls[at] };
  };
  const tick = () => {
    const r = p.run('watchdog', 'run');
    assert.equal(r.status, 0, r.stderr);
  };
  const tap = (id, data) => receive({ callback_query: { id: `q${update}`, data, message: { message_id: id, chat: CHAT } } });
  return { ...p, remoteHead, head, commit, receive, tg, idOf, tick, tap };
}

test('push is unlocked per project only at a terminal, with the project\'s name typed, and locked again (D194)', () => {
  const p = pushable();
  const list = p.run('rules', p.dir);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /push +locked +pushing with git/);
  assert.match(list.stdout, /deploy-vercel +locked/);
  // A command run by the model has no terminal.
  const piped = p.runWithInput({}, 'demo\n', 'rules', 'unlock', 'push', p.dir);
  assert.equal(piped.status, 1);
  assert.match(piped.stderr, /at a terminal on this Mac/);
  assert.equal(p.runWithInput({ JEROME_TEST_TTY: '1' }, 'other\n', 'rules', 'unlock', 'push', p.dir).status, 1);
  assert.match(p.run('rules', p.dir).stdout, /push +locked/);
  const ok = p.runWithInput({ JEROME_TEST_TTY: '1' }, 'demo\n', 'rules', 'unlock', 'push', p.dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(p.run('rules', p.dir).stdout, /push +unlocked/);
  // A session is told the push is Jérôme's, so the lead agent never asks the user to push.
  const start = JSON.parse(p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir }, JSON.stringify({ cwd: p.dir, session_id: 'talk', source: 'startup' }), 'hook', 'session-start').stdout);
  assert.match(start.hookSpecificOutput.additionalContext, /The push of main is unlocked in this project/);
  // Nothing in the repository changed: the choice is kept outside it.
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: p.dir, encoding: 'utf8' }), '');
  // The lead agent hears of it as a note, to record as a decision.
  const db = p.db();
  assert.match(db.prepare('SELECT text FROM notes ORDER BY id DESC').get().text, /push of main is unlocked/);
  db.close();
  assert.equal(p.run('rules', 'lock', 'push', p.dir).status, 0);
  assert.match(p.run('rules', p.dir).stdout, /push +locked/);
});

test('with push unlocked, main\'s new commits are asked on Telegram once, "not now" waits for new ones, and a yes pushes main (D194)', () => {
  const p = pushable();
  // Locked: never asked.
  p.commit('one');
  p.tick();
  assert.ok(!p.tg().some((c) => c.method === 'sendMessage' && /Shall I push/.test(c.params.text)));
  assert.equal(p.runWithInput({ JEROME_TEST_TTY: '1' }, 'demo\n', 'rules', 'unlock', 'push', p.dir).status, 0);
  p.tick();
  const first = p.idOf(/Shall I push main/);
  assert.match(first.call.params.text, /1 commit on main not pushed yet:\n• Add one/);
  const head = p.head().slice(0, 12);
  assert.deepEqual(first.call.params.reply_markup.inline_keyboard.map((r) => r[0].callback_data), [`p:${head}:go`, `p:${head}:no`]);
  // Asked once.
  p.tick();
  assert.equal(p.tg().filter((c) => c.method === 'sendMessage' && /Shall I push/.test(c.params.text)).length, 1);

  // "Not now": not asked again until main has new commits.
  p.tap(first.id, `p:${head}:no`);
  p.tick();
  assert.match(p.idOf(/Not pushed/).call.params.text, /I ask again when main has new commits/);
  p.tick();
  assert.equal(p.tg().filter((c) => c.method === 'sendMessage' && /Shall I push/.test(c.params.text)).length, 1);
  p.commit('two');
  p.tick();
  const second = p.idOf(/Shall I push main/);
  assert.notEqual(second.id, first.id);
  assert.match(second.call.params.text, /2 commits on main/);

  // A tap on the old question does nothing: main has moved since.
  p.tap(first.id, `p:${head}:go`);
  p.tick();
  assert.notEqual(p.remoteHead(), p.head());

  // Yes: main is pushed, to its own remote, and the lead agent is told.
  const now = p.head().slice(0, 12);
  p.tap(second.id, `p:${now}:go`);
  p.tick();
  assert.equal(p.remoteHead(), p.head());
  assert.match(p.idOf(/Pushed/).call.params.text, /Pushed: main, 2 commits/);
  const db = p.db();
  assert.match(db.prepare('SELECT text FROM notes ORDER BY id DESC').get().text, /main pushed \(2 commits/);
  db.close();
  // Its buttons are taken off, and nothing more is asked.
  assert.ok(p.tg().some((c) => c.method === 'editMessageReplyMarkup' && c.params.message_id === second.id && !c.params.reply_markup.inline_keyboard.length));
  const asked = p.tg().filter((c) => c.method === 'sendMessage' && /Shall I push/.test(c.params.text)).length;
  p.tick();
  assert.equal(p.tg().filter((c) => c.method === 'sendMessage' && /Shall I push/.test(c.params.text)).length, asked);

  // A push that fails is told with git's reason, and keeps its buttons for another tap.
  p.commit('three');
  p.tick();
  const third = p.idOf(/Shall I push main/);
  const h3 = p.head().slice(0, 12);
  p.git('remote', 'set-url', 'origin', join(p.root, 'gone.git'));
  p.tap(third.id, `p:${h3}:go`);
  p.tick();
  assert.match(p.idOf(/push of main failed/).call.params.text, /The push of main failed: .+/);
  assert.ok(!p.tg().some((c) => c.method === 'editMessageReplyMarkup' && c.params.message_id === third.id));
  p.git('remote', 'set-url', 'origin', join(p.root, 'remote.git'));
  p.tap(third.id, `p:${h3}:go`);
  p.tick();
  assert.equal(p.remoteHead(), p.head());
  const asked3 = p.tg().filter((c) => c.method === 'sendMessage' && /Shall I push/.test(c.params.text)).length;

  // Locked again: new commits are not asked.
  assert.equal(p.run('rules', 'lock', 'push', p.dir).status, 0);
  p.commit('four');
  p.tick();
  assert.equal(p.tg().filter((c) => c.method === 'sendMessage' && /Shall I push/.test(c.params.text)).length, asked3);
});

test('the model is refused unlocking, in a session too, and its run is told the push is Jérôme\'s (D194)', () => {
  for (const c of ['jerome rules unlock push', 'node bin/jerome.js rules unlock push', 'echo {} > ~/.local/share/jerome/projects/demo-1/unlocked.json', 'rm ~/.local/share/jerome/projects/demo-1/push.json']) {
    assert.ok(usersOnly(c), c);
  }
  for (const c of ['jerome rules', 'jerome rules lock push', 'git status']) assert.equal(usersOnly(c), null, c);
  const unlocked = leadPrompt('a task', null, [], { config: { mainBranch: 'main' }, push: true });
  assert.match(unlocked, /The push of main is Jérôme's in this project/);
  assert.match(unlocked, /never open a request about pushing main/);
  assert.match(leadPrompt('a task', null, [], { config: { mainBranch: 'main' } }), /needs a push, a deploy or a release, which only the user does, open a request/);
});

test('another group unlocked moves from deny to ask, committed on main; a session is asked, a heartbeat refused; locked again it is denied (D195)', () => {
  const p = pushable();
  const settings = () => JSON.parse(readFileSync(join(p.dir, '.claude', 'settings.json'), 'utf8')).permissions;
  const log = () => execFileSync('git', ['log', '-1', '--format=%s'], { cwd: p.dir, encoding: 'utf8' }).trim();
  assert.ok(settings().deny.includes('Bash(fly deploy *)'));
  // Not while a change of the user's own to settings.json waits.
  const s0 = readFileSync(join(p.dir, '.claude', 'settings.json'), 'utf8');
  writeFileSync(join(p.dir, '.claude', 'settings.json'), s0.replace('"permissions"', '"model": "opus", "permissions"'));
  const busy = p.runWithInput({ JEROME_TEST_TTY: '1' }, 'demo\n', 'rules', 'unlock', 'deploy-fly', p.dir);
  assert.equal(busy.status, 1);
  assert.match(busy.stderr, /changes not committed/);
  writeFileSync(join(p.dir, '.claude', 'settings.json'), s0);

  const ok = p.runWithInput({ JEROME_TEST_TTY: '1' }, 'demo\n', 'rules', 'unlock', 'deploy-fly', p.dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(!settings().deny.includes('Bash(fly deploy *)'));
  assert.ok(settings().ask.includes('Bash(fly deploy *)') && settings().ask.includes('Bash(flyctl deploy *)'));
  assert.ok(settings().deny.includes('Bash(vercel deploy *)'), 'the other groups stay denied');
  assert.equal(log(), 'jerome rules: deploy-fly unlocked, asked each time in sessions (D195)');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: p.dir, encoding: 'utf8' }), '');
  assert.match(p.run('rules', p.dir).stdout, /deploy-fly +unlocked/);
  // doctor keeps it so: the rules moved are not missing.
  const check = p.run('doctor', '--check', p.dir);
  assert.match(check.stdout, /Default limits — \d+ permission rules in place/, check.stdout);
  assert.ok(settings().ask.includes('Bash(fly deploy *)'));
  // A heartbeat is refused it by its hook, a session is not; others are untouched.
  const hook = (command, kind) => p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir, ...(kind ? { JEROME_RUN_KIND: kind } : {}) }, JSON.stringify({ cwd: p.dir, tool_name: 'Bash', tool_input: { command } }), 'hook', 'pre-tool-use').stdout;
  assert.match(hook('cd app && FLY_APP=x fly deploy --remote-only', 'heartbeat'), /sessions only/);
  assert.equal(hook('fly status', 'heartbeat'), '');
  assert.match(hook('fly deploy', 'heartbeat'), /"permissionDecision":"deny".*D195/);
  assert.equal(hook('fly deploy'), '');
  // A session is told what is unlocked.
  const start = JSON.parse(p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir }, JSON.stringify({ cwd: p.dir, session_id: 's', source: 'startup' }), 'hook', 'session-start').stdout);
  assert.match(start.hookSpecificOutput.additionalContext, /for sessions only \(D195\): deploying on Fly\.io/);

  assert.equal(p.run('rules', 'lock', 'deploy-fly', p.dir).status, 0);
  assert.ok(settings().deny.includes('Bash(fly deploy *)') && !settings().ask.includes('Bash(fly deploy *)'));
  assert.equal(log(), 'jerome rules: deploy-fly locked again (D195)');
  assert.equal(hook('fly deploy', 'heartbeat'), '', 'denied again by the rule, not the hook');
  assert.match(p.run('rules', p.dir).stdout, /deploy-fly +locked/);
});
