// A project's board (D177): its items read from the state files, rewritten in plain words once by a worker the
// watchdog starts, shown by the project's viewer and sent to the Director.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readyProject } from './sandbox.js';
import { sections, kindOf, owner } from '../src/board.js';

const OPEN = `# Open

## To do
O17: archive for launch (D12): fill each discipline to 6 months (ricercatore)
O2: write \`.jerome/PROJECT.md\` from /Users/odinai/Projects/demo/docs/v2.md (lead)

## Parked ideas (keep as ideas, not to do)
P1: "parete del tempo" for the year round

## Decision requests

## Backlog
- tools/check.sh fails on day 28: find why

## Assumptions
A34: batch18 merged although check.sh exits 1
`;
const ARCHIVE = `# Archive

## Closed open items
O5: each question gets a difficulty — done 2026-10-27 (merged, cache v72)
O14: discipline on every card — done 2026-10-28 (merged)
`;
const DIGEST = `# Digest

- 2026-10-28 20:00 · O17 step 9: batch17 +31 easy outdoor cards · agent/o17-batch17 → main · none
- 2026-10-29 · O17 step 10: batch18 +33 cards · agent/o17-batch18 → main · none
`;

test('the board reads open.md by its sections: work to do, spare-time work, parked ideas; assumptions and requests stay out', () => {
  const items = sections(OPEN);
  assert.deepEqual(items.map((x) => [x.id, kindOf(x.heading)]), [['O17', 'todo'], ['O2', 'todo'], ['P1', 'parked'], [null, 'backlog'], ['A34', null]]);
  // Whose: a question for the user, asked or not yet; work that waits for them at a session; Jérôme's work.
  assert.equal(kindOf('Open questions'), 'ask');
  assert.equal(owner('ask', 'Q2: do you push main yourself?'), 'ask');
  assert.equal(owner('ask', 'Q2: do you push main yourself? (asked: R7)'), 'asked');
  assert.equal(owner('todo', 'O4: update the 8:45 routine (lead, interactive session)'), 'you');
  assert.equal(owner('todo', 'O17: archive for launch (ricercatore)'), 'todo');
});

test('the watchdog has the board\'s texts rewritten once in plain words, and the viewer and the board show those', async () => {
  const p = readyProject({ JEROME_PLAIN_SYNC: '1' });
  writeFileSync(join(p.dir, '.jerome', 'open.md'), OPEN);
  writeFileSync(join(p.dir, '.jerome', 'archive.md'), ARCHIVE);
  writeFileSync(join(p.dir, '.jerome', 'digest.md'), DIGEST);
  // Claude Code failing: nothing is written, the board keeps the project's own words.
  assert.equal(p.runWith({ FAKE_PLAIN_FAIL: '1' }, 'watchdog', 'run').status, 0);
  const cache = join(p.root, '.cache', 'jerome', 'plain', 'en.json');
  assert.ok(!existsSync(cache));
  assert.equal(p.run('watchdog', 'run').status, 0);
  const plain = JSON.parse(readFileSync(cache, 'utf8'));
  const texts = Object.values(plain).map((x) => x.text);
  assert.ok(texts.includes('plain: archive for launch (D12): fill each discipline to 6 months (ricercatore)'));
  assert.ok(texts.includes('plain: each question gets a difficulty'), 'a closed item without its "done" tail');
  assert.ok(!texts.some((t) => t.includes('/Users/')), 'no path is sent to be rewritten');
  assert.ok(!texts.some((t) => t.includes('A34')), 'the assumptions stay out');
  const calls = readFileSync(join(p.root, 'plain-calls.log'), 'utf8').split('\n').filter(Boolean).length;
  // Once only: the next minute asks nothing.
  p.run('watchdog', 'run');
  assert.equal(readFileSync(join(p.root, 'plain-calls.log'), 'utf8').split('\n').filter(Boolean).length, calls);

  // The board as the viewer gets it, in the project's process.
  process.env.XDG_CACHE_HOME = join(p.root, '.cache');
  process.env.XDG_DATA_HOME = join(p.root, '.local', 'share');
  const { projectBoard } = await import('../src/board.js');
  const board = projectBoard(p.dir, { code: 'en' });
  assert.equal(board.now, null);
  assert.deepEqual(board.todo.map((x) => [x.id, x.kind]), [['O17', 'todo'], ['O2', 'todo'], [null, 'backlog']]);
  assert.match(board.todo[0].text, /^plain: archive for launch/);
  assert.deepEqual(board.closed.map((x) => [x.id, x.at]), [['O14', '2026-10-28'], ['O5', '2026-10-27']]);
  assert.deepEqual(board.done.map((x) => x.at), ['2026-10-29', '2026-10-28 20:00'], 'newest first');
  assert.deepEqual(board.parked.map((x) => x.id), ['P1']);
});

test('a question whose request was answered leaves the board, and the next run is told the answer to record (D192)', async () => {
  const p = readyProject();
  writeFileSync(join(p.dir, '.jerome', 'open.md'), '# Open\n\n## Open questions\n- Q1: Which host? (asked: R1)\n- Q2: Which domain? (asked: R2)\n- Q3: Which logo?\n');
  for (const q of ['Which host?', 'Which domain?']) assert.equal(p.runIn(p.dir, 'request', 'open', '--question', q, '--options', 'A) one / B) two').status, 0);
  assert.equal(p.runIn(p.dir, 'request', 'answer', '1', 'B) two').status, 0);
  process.env.XDG_CACHE_HOME = join(p.root, '.cache');
  process.env.XDG_DATA_HOME = join(p.root, '.local', 'share');
  const { projectBoard } = await import('../src/board.js');
  const { answersToRecord } = await import('../src/answers.js');
  const board = projectBoard(p.dir, { code: 'en', plain: (t) => t });
  assert.deepEqual(board.todo.map((x) => [x.id, x.kind]), [['Q2', 'asked'], ['Q3', 'ask']]);
  const answers = answersToRecord(p.dir);
  assert.deepEqual(answers, [{ id: 1, status: 'answered', question: 'Which host?', answer: 'B) two' }]);
  const { leadPrompt } = await import('../src/heartbeat.js');
  assert.match(leadPrompt('x', null, [], { answers }), /The user answered these questions of open\.md[^\n]*R1 "Which host\?" → "B\) two"[^\n]*record each answer as a decision/);
  assert.doesNotMatch(leadPrompt('x'), /The user answered these questions/);
});
