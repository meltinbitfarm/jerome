// The list of Claude Code dependencies (D77) against the code: every field the code reads from Claude Code's
// payloads, transcripts, results, streams and status line, every flag it passes to `claude`, and every /context
// section it parses must be listed, so the list cannot fall behind a phase unnoticed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DEPS, DEPS_SCHEMA } from '../src/deps.js';
import { CONTEXT_SECTIONS } from '../src/profile.js';

const src = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const listed = (area, path, event) => DEPS.some((d) => d.area === area && d.path === path && (event === undefined || d.event === event || d.event === '*'));
const all = (re, text) => [...text.matchAll(re)].map((m) => m.slice(1).filter(Boolean).join('.'));

test('every hook payload field the hooks read is listed', () => {
  const fields = new Set(all(/payload\.([a-z_]+)(?:\?\.([a-z_]+))?/g, src('hooks.js')));
  assert.ok(fields.size >= 10);
  for (const f of fields) assert.ok(listed('hook-input', f), `hook-input ${f}`);
  for (const [event, path] of [['PreToolUse', 'tool_input.command'], ['SessionEnd', 'reason'], ['SubagentStop', 'last_assistant_message'], ['SubagentStop', 'agent_transcript_path']]) {
    assert.ok(listed('hook-input', path, event), `${event} ${path}`);
  }
});

test('every transcript usage field and every stream field the code reads is listed', () => {
  for (const f of new Set(all(/\bu\.([a-z_0-9]+)(?:\?\.([a-z_0-9]+))?/g, src('usage.js')))) assert.ok(listed('transcript', `message.usage.${f}`), `transcript ${f}`);
  const lead = src('heartbeat.js').slice(src('heartbeat.js').indexOf('function runLead'));
  for (const f of new Set(all(/\bu\.([a-z_0-9]+)/g, lead))) assert.ok(listed('stream', `message.usage.${f}`), `stream ${f}`);
  for (const f of new Set(all(/windows\[w\]\??\.([a-zA-Z]+)/g, lead))) {
    for (const w of ['five_hour', 'seven_day']) assert.ok(listed('stream', `rate_limit_info.unifiedWindows.${w}.${f}`), `stream ${w}.${f}`);
  }
});

test('every result, status line and subagent meta field the code reads is listed', () => {
  for (const f of new Set(all(/\bu\.([a-zA-Z]+Tokens)/g, src('docs.js')))) assert.ok(listed('result', `modelUsage.*.${f}`), `result ${f}`);
  for (const f of new Set(all(/result\.([a-zA-Z_]+)/g, src('docs.js')).filter((f) => f !== 'modelUsage'))) assert.ok(listed('result', f), `result ${f}`);
  const status = src('statusline.js');
  // Fields of the status line input are snake_case; w.used, w.limit and the like are Jérôme's own window records.
  for (const f of new Set(all(/\bw\.([a-z]+_[a-z_]+)/g, status))) {
    for (const w of ['five_hour', 'seven_day']) assert.ok(listed('statusline-input', `rate_limits.${w}.${f}`), `status line ${w}.${f}`);
  }
  for (const f of ['workspace.project_dir', 'cwd']) assert.ok(listed('statusline-input', f), f);
  for (const f of new Set(all(/meta\.([a-zA-Z]+)/g, src('delegations.js')).filter((f) => f !== 'json'))) assert.ok(listed('subagent-meta', f), `meta ${f}`);
});

test('every flag passed to claude and every /context section parsed is listed', () => {
  // Flags these files pass to git, not to claude.
  const git = new Set(['--verify', '--porcelain', '--untracked-files', '--oneline', '--first-parent']);
  for (const file of ['profile.js', 'docs.js', 'heartbeat.js']) {
    for (const flag of new Set(all(/'(--[a-zA-Z-]+)/g, src(file)))) if (!git.has(flag)) assert.ok(listed('cli', flag), `${file} ${flag}`);
  }
  for (const { heading, header } of Object.values(CONTEXT_SECTIONS)) {
    assert.ok(listed('context', `### ${heading} | ${header.join(' | ')}`), heading);
  }
});

test('jerome deps --json prints the versioned list', () => {
  const r = spawnSync(process.execPath, [new URL('../bin/jerome.js', import.meta.url).pathname, 'deps', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.schema, DEPS_SCHEMA);
  assert.ok(report.items.length > 50);
  for (const item of report.items) {
    for (const key of ['area', 'path', 'kind', 'presence', 'documented', 'decisions', 'phase', 'code', 'use']) assert.ok(key in item, `${item.path}: ${key}`);
    assert.ok(['always', 'sometimes'].includes(item.presence));
    assert.ok(Number.isInteger(item.phase) && item.phase >= 1 && item.phase <= 10, `${item.path}: phase`);
  }
});
