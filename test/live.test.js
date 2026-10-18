// Tests of the live view of a run (D115): the lead agent and its subagents read from the transcripts as they grow,
// their status from results and handbacks, the log, the tokens against the run's caps, and nothing written.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = mkdtempSync(join(tmpdir(), 'jerome-live-'));
process.env.CLAUDE_CONFIG_DIR = join(root, 'claude-config');
const { openDb, dbPath } = await import('../src/db.js');
const { liveRun, forgetReaders } = await import('../src/live.js');
const { startViewer } = await import('../src/view.js');

const dir = join(root, 'demo');
const SESSION = 'live-1';
const START = Date.parse('2026-10-18T10:00:00Z');
const t = (sec) => new Date(START + sec * 1000).toISOString();
const sessionDir = join(process.env.CLAUDE_CONFIG_DIR, 'projects', '-demo', SESSION);
const main = `${sessionDir}.jsonl`;
let viewer;

let request_ = 0;
const call = (sec, model, content, { context = 10_000, output = 100 } = {}) => `${JSON.stringify({ type: 'assistant', timestamp: t(sec), requestId: `r${++request_}`,
  message: { model, usage: { input_tokens: 0, cache_read_input_tokens: context, cache_creation_input_tokens: 0, output_tokens: output }, content } })}\n`;
const use = (name, input, id = `x${request_ + 1}`) => [{ type: 'tool_use', id, name, input }];
const result = (sec, id, text) => `${JSON.stringify({ type: 'user', timestamp: t(sec), message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } })}\n`;
const sub = (id, meta, lines) => {
  writeFileSync(join(sessionDir, 'subagents', `agent-${id}.meta.json`), JSON.stringify(meta));
  writeFileSync(join(sessionDir, 'subagents', `agent-${id}.jsonl`), lines);
};

before(async () => {
  mkdirSync(join(dir, '.jerome'), { recursive: true });
  writeFileSync(join(dir, '.jerome', 'project.json'), '');
  const db = openDb(dir, { create: true });
  db.prepare("INSERT INTO runs (id, session_id, kind, started_at, status, area, caps) VALUES (1, ?, 'heartbeat', ?, 'running', 'development', ?)")
    .run(SESSION, t(0), JSON.stringify({ maxTokens: 200_000, maxTurns: 40, once: true }));
  db.prepare("INSERT INTO events (run_id, at, kind, agent, data) VALUES (1, ?, 'blocked', 'developer', ?)").run(t(70), JSON.stringify({ subcommands: ['git add', 'git commit'] }));
  db.close();
  mkdirSync(join(sessionDir, 'subagents'), { recursive: true });
  writeFileSync(main,
    // A line from before the run (a resumed session) is left out.
    call(-30, 'claude-opus-5-5', [{ type: 'text', text: 'earlier' }], { context: 999_000 })
    + call(5, 'claude-opus-5-5', use('Read', { file_path: '.jerome/areas.md' }))
    + call(10, 'claude-opus-5-5', use('Agent', { subagent_type: 'analyst', description: 'Review the criteria', prompt: 'p' }, 'tA'))
    + result(40, 'tA', 'Two criteria are not covered by tests.')
    + call(45, 'claude-opus-5-5', use('Agent', { subagent_type: 'developer', description: 'Fix the parser', prompt: 'p' }, 'tD')
      .concat(use('Agent', { subagent_type: 'researcher', description: 'Read the page', prompt: 'p', run_in_background: true }, 'tR'))
      .concat(use('Agent', { subagent_type: 'developer', description: 'Write the docs', prompt: 'p' }, 'tE')), { context: 30_000, output: 500 })
    + result(46, 'tR', 'Started in the background.'));
  sub('a1', { agentType: 'analyst', description: 'Review the criteria', toolUseId: 'tA', requestShape: 'foreground' },
    call(12, 'claude-sonnet-5-5', use('Grep', { pattern: 'rate_limit_event' })));
  sub('d1', { agentType: 'developer', description: 'Fix the parser', toolUseId: 'tD', requestShape: 'foreground' },
    call(50, 'claude-opus-5-5', use('Edit', { file_path: 'src/parse.js' }))
    + call(60, 'claude-opus-5-5', use('Bash', { command: 'npm test', description: 'Run the tests' })));
  sub('r1', { agentType: 'researcher', description: 'Read the page', toolUseId: 'tR', requestShape: 'background' },
    call(48, 'claude-sonnet-5-5', use('Read', { file_path: '.jerome/watch/code.claude.com/docs/en/hooks.md' })));
  viewer = await startViewer(dir, { token: 'live-token' });
});

after(() => viewer?.server.close());

const now = new Date(START + 90_000);
const agent = (live, label) => live.agents.find((a) => a.label === label);

test('the lead agent and each subagent, with their status from results and handbacks', () => {
  forgetReaders();
  const live = liveRun(dir, 1, { now });
  assert.deepEqual(live.run.caps, { maxTokens: 200_000, maxTurns: 40, once: true });
  assert.equal(live.lead.model, 'claude-opus-5-5');
  assert.deepEqual(live.lead.lastCall, { at: t(45), context: 30_000, output: 500 });
  assert.deepEqual(live.agents.map((a) => [a.label, a.status, a.background]),
    [['analyst', 'done', false], ['developer 1', 'running', false], ['researcher', 'running', true], ['developer 2', 'starting', false]]);
  assert.equal(agent(live, 'analyst').replyWords, 7);
  assert.equal(agent(live, 'analyst').model, 'claude-sonnet-5-5');
  assert.equal(agent(live, 'developer 1').description, 'Fix the parser');
  assert.deepEqual(live.lead.waitingFor, ['developer 1', 'developer 2']);
  assert.equal(live.active, 3);
  assert.equal(live.elapsedMs, 90_000);
});

test('the run\'s tokens count every call once, from the run\'s start, against its cap', () => {
  forgetReaders();
  const live = liveRun(dir, 1, { now });
  // Lead: 3 calls of 10,100 and one of 30,500; analyst one, developer two, researcher one, of 10,100 each.
  assert.equal(live.tokens.total, 3 * 10_100 + 30_500 - 10_100 + 4 * 10_100);
  assert.equal(live.tokens.main, 2 * 10_100 + 30_500);
  assert.equal(live.cap.tokens, 200_000);
  assert.equal(live.cap.turns, 40);
  assert.equal(live.cap.once, true);
  assert.equal(live.cap.share, live.tokens.total / 200_000);
});

test('the log mixes every agent\'s actions with the refused chains, oldest first', () => {
  forgetReaders();
  const live = liveRun(dir, 1, { now });
  assert.deepEqual(live.log.map((l) => [l.agent, l.action, l.detail]), [
    ['main', 'Read', '.jerome/areas.md'],
    ['main', 'delegate', '→ analyst: Review the criteria'],
    ['analyst', 'Grep', 'rate_limit_event'],
    ['analyst', 'result', '→ main (7 words)'],
    ['main', 'delegate', '→ developer: Fix the parser'],
    ['main', 'delegate', '→ researcher: Read the page'],
    ['main', 'delegate', '→ developer: Write the docs'],
    ['researcher', 'Read', '.jerome/watch/code.claude.com/docs/en/hooks.md'],
    ['developer 1', 'Edit', 'src/parse.js'],
    ['developer 1', 'Bash', 'Run the tests'],
    ['developer', 'blocked', 'git add && git commit (chained commands refused)'],
  ]);
});

test('lines added since the last reading are read, and a handback ends a subagent in the background', () => {
  forgetReaders();
  liveRun(dir, 1, { now });
  appendFileSync(join(sessionDir, 'subagents', 'agent-r1.jsonl'),
    call(80, 'claude-sonnet-5-5', use('SubagentHandback', { message: 'The page added two fields.' })));
  // A line still being written is left for the next reading.
  appendFileSync(join(sessionDir, 'subagents', 'agent-d1.jsonl'), '{"type":"assistant","timestamp":');
  const live = liveRun(dir, 1, { now });
  assert.equal(agent(live, 'researcher').status, 'done');
  assert.equal(agent(live, 'researcher').endedAt, t(80));
  assert.deepEqual(live.log.at(-1), { at: t(80), agent: 'researcher', action: 'handback', detail: '"The page added two fields." (5 words)' });
  assert.equal(agent(live, 'developer 1').status, 'running');
});

test('once the run ends, subagents without a result are shown as ended', () => {
  forgetReaders();
  const db = openDb(dir);
  db.prepare("UPDATE runs SET status = 'stopped', ended_at = ? WHERE id = 1").run(t(95));
  db.close();
  const live = liveRun(dir, 1, { now: new Date(START + 200_000) });
  assert.equal(agent(live, 'developer 1').status, 'ended');
  assert.equal(live.active, 0);
  assert.equal(live.elapsedMs, 95_000);
  const back = openDb(dir);
  back.prepare("UPDATE runs SET status = 'running', ended_at = NULL WHERE id = 1").run();
  back.close();
});

function get(path, token = 'live-token') {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: viewer.port, path: `${path}${token ? `?t=${token}` : ''}` }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => done({ status: res.statusCode, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

test('the viewer serves it at /api/runs/<id>/live, behind its token, and writes nothing', async () => {
  const fingerprint = () => createHash('sha256').update(readFileSync(dbPath(dir))).digest('hex');
  const before = fingerprint();
  assert.equal((await get('/api/runs/1/live', null)).status, 403);
  const live = JSON.parse((await get('/api/runs/1/live')).body);
  assert.equal(live.run.id, 1);
  assert.ok(live.agents.length >= 4);
  assert.deepEqual(JSON.parse((await get('/api/runs/9/live')).body), { error: 'no such run' });
  assert.equal(fingerprint(), before);
});

test('the page moves only with real data, and not at all with reduced motion', async () => {
  const page = (await get('/')).body;
  assert.match(page, /location\.hash = `live-\$\{r\.id\}`/);
  assert.match(page, /setTimeout\(pollLive, 2000\)/);
  assert.match(page, /a\.status === 'running' \|\| a\.status === 'starting' \? 'link flow'/);
  assert.match(page, /if \(!path \|\| reducedMotion\(\)\) return;/);
  assert.match(page, /@media \(prefers-reduced-motion: reduce\) \{\s*\.link\.flow \{ animation: none; \}/);
  assert.doesNotMatch(page, /innerHTML|insertAdjacentHTML|outerHTML/);
});
