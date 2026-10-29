// The quota governor (D140-D143): the pace as a pure function, the usage endpoint read from a file standing for it,
// and fill runs started by the watchdog on throwaway projects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pace, modelFor } from '../src/pacing.js';
import { parseUsage } from '../src/quota.js';
import { slotWithin } from '../src/heartbeatconfig.js';
import { triagePrompt } from '../src/heartbeat.js';
import { readyProject } from './sandbox.js';

const H = 3_600_000;
const now = new Date('2026-10-30T12:00:00Z');
// A week that resets in `left` hours, used at `used`%, and a 5-hour window.
const at = (left, used, five = 10, fiveLeft = 3) => ({
  windows: { seven_day: { used, resetsAt: (now.getTime() + left * H) / 1000 }, five_hour: { used: five, resetsAt: (now.getTime() + fiveLeft * H) / 1000 } },
  readAt: new Date(now.getTime() - 2 * 60_000),
  now,
});

test('the pace: behind the curve goes, ahead holds, the 5-hour cap and the reserve hold, the last day releases it', () => {
  // Half the week gone: the curve is at 45%.
  assert.deepEqual([pace(at(84, 30)).verdict, pace(at(84, 30)).kind, pace(at(84, 30)).target], ['go', 'behind', 45]);
  assert.deepEqual([pace(at(84, 50)).verdict, pace(at(84, 50)).kind], ['hold', 'ahead']);
  assert.equal(pace(at(84, 30, 91)).kind, 'cap');
  // 80% is where the reserve starts, two days before the reset.
  assert.deepEqual([pace(at(48, 81)).kind, pace(at(48, 81)).ceiling], ['reserve', 80]);
  // Six hours before the reset, three quarters of the reserve are released.
  const late = pace(at(6, 88));
  assert.deepEqual([late.verdict, late.kind, late.ceiling], ['go', 'release', 95]);
  assert.equal(pace(at(6, 96)).kind, 'reserve');
  // The 5-hour window resetting within the hour, with room: a little ahead of the curve is fine.
  assert.deepEqual([pace(at(84, 47, 30, 0.5)).verdict, pace(at(84, 47, 30, 0.5)).kind], ['go', 'burst']);
  assert.equal(pace(at(84, 47, 30, 2)).kind, 'ahead');
  // A reading too old, or none: a reduced pace, no fill runs.
  assert.equal(pace({ ...at(84, 30), readAt: new Date(now.getTime() - 45 * 60_000) }).verdict, 'reduced');
  assert.equal(pace({ windows: {}, now }).kind, 'stale');
  assert.equal(pace({ ...at(-1, 30) }).kind, 'stale');
});

test('a model whose own weekly limit is ahead of the curve gives way to sonnet', () => {
  const p = pace({ ...at(84, 30), scoped: [{ model: 'Fable', used: 60 }, { model: 'Other', used: 10 }] });
  assert.deepEqual(p.avoid, ['Fable']);
  assert.deepEqual(modelFor('claude-fable-5-1', p.avoid), { model: 'sonnet', why: 'model sonnet: Fable\'s weekly limit is ahead of its pace' });
  assert.equal(modelFor('opus', p.avoid), null);
});

// The endpoint's answer as it came on 2026-10-28, trimmed.
const answer = (used = 6, five = 14) => ({
  five_hour: { utilization: five, resets_at: new Date(Date.now() + 2 * H).toISOString() },
  seven_day: { utilization: used, resets_at: new Date(Date.now() + 6.5 * 24 * H).toISOString() },
  seven_day_opus: null,
  limits: [
    { kind: 'session', percent: five, resets_at: new Date(Date.now() + 2 * H).toISOString(), scope: null },
    { kind: 'weekly_scoped', percent: 0, resets_at: new Date(Date.now() + 6.5 * 24 * H).toISOString(), scope: { model: { id: null, display_name: 'Fable' } } },
  ],
  seven_day_breakdown: { rows: [{ key: 'claude_code', display_name: 'Claude Code', percent: 38 }, { key: 'chat', display_name: 'Chats', percent: 62 }] },
});

test('the endpoint\'s answer: windows in whole percent with resets in seconds, scoped limits, the share by surface', () => {
  const r = parseUsage(answer());
  assert.deepEqual(Object.keys(r.windows), ['five_hour', 'seven_day']);
  assert.equal(r.windows.seven_day.used, 6);
  assert.equal(typeof r.windows.seven_day.resetsAt, 'number');
  assert.deepEqual(r.scoped.map((s) => [s.model, s.used]), [['Fable', 0]]);
  assert.deepEqual(r.breakdown.map((b) => b.percent), [38, 62]);
});

function governed(env = {}) {
  const p = readyProject({ JEROME_NOTIFY: 'off', JEROME_FILL_SYNC: '1', ...env });
  const endpoint = join(p.root, 'usage.json');
  const answers = (body) => writeFileSync(endpoint, JSON.stringify(body));
  answers(answer());
  const run = (...args) => p.runWith({ JEROME_QUOTA_FAKE: endpoint }, ...args);
  return { ...p, answers, endpoint, gov: run };
}

test('jerome quota reads the endpoint and says the pace; with no answer it says so and keeps the last reading', () => {
  const p = governed();
  const r = p.gov('quota');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^quota {4}5h 14% \(resets .*\) · 7d 6% \(resets .*\) · read 0 min ago from the usage endpoint$/m);
  assert.match(r.stdout, /Fable 0% of its weekly limit · this week Claude Code 38%, Chats 62%/);
  assert.match(r.stdout, /^pace {5}target now 6\.4% · ceiling 80% · go: 7d 6% behind its pace, 6\.4%$/m);
  const account = JSON.parse(readFileSync(join(p.root, '.config', 'jerome', 'account.json'), 'utf8'));
  assert.equal(account.windows.seven_day.source, 'oauth');
  assert.doesNotMatch(JSON.stringify(account), /token/i);
  writeFileSync(p.endpoint, 'not json');
  const failed = p.gov('quota');
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /7d 6%[\s\S]*the usage endpoint did not answer/);
});

test('the watchdog starts fill runs when the week is behind, staggered, and a slot\'s run holds at the 5-hour cap', () => {
  const p = governed({ FAKE_TRIAGE: '{"work": true, "task": "Add tests for the parser"}' });
  assert.equal(p.gov('governor', 'on').status, 0);
  assert.match(p.runIn(p.dir, 'governor', 'add').stdout, /gets fill runs[\s\S]*Its own limits still apply \(daily \$5, weekly \$20/);
  assert.equal(p.gov('watchdog', 'run').status, 0);
  const runs = () => {
    const d = p.db();
    const rows = d.prepare('SELECT status, reason, fill, quota FROM runs ORDER BY id').all();
    d.close();
    return rows;
  };
  const [fill] = runs();
  assert.equal(fill.fill, 1);
  assert.equal(fill.status, 'done', fill.reason);
  assert.deepEqual(JSON.parse(fill.quota), { model: 'opus', before: { five_hour: 14, seven_day: 6 }, after: { five_hour: 14, seven_day: 6 } });
  assert.match(p.calls(), /## This is a fill run/);
  assert.match(readFileSync(join(p.root, 'lead-prompt'), 'utf8'), /This is a fill run[\s\S]*Backlog section of open\.md/);
  assert.match(readFileSync(join(p.root, '.cache', 'jerome', 'logs', 'watchdog.log'), 'utf8'), /governor: go, 7d 6% behind its pace[\s\S]*governor: fill run in /);
  // The project has just had its run: the next minute leaves it alone.
  p.gov('watchdog', 'run');
  assert.equal(runs().length, 1);
  // Runs may go in parallel but start staggered (D144): with the project free again, not within 5 minutes of the
  // last start, nor before a reading taken since; then it goes.
  const d = p.writableDb();
  d.prepare('UPDATE runs SET started_at = ?').run(new Date(Date.now() - 40 * 60_000).toISOString());
  d.close();
  p.gov('watchdog', 'run');
  assert.equal(runs().length, 1, 'within 5 minutes of the last start');
  const lastPath = join(p.root, '.cache', 'jerome', 'governor', 'last.json');
  const accountPath = join(p.root, '.config', 'jerome', 'account.json');
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  writeFileSync(lastPath, JSON.stringify({ ...JSON.parse(readFileSync(lastPath, 'utf8')), startedAt: ago(10) }));
  const account = JSON.parse(readFileSync(accountPath, 'utf8'));
  account.quota.readAt = ago(20);
  for (const w of Object.values(account.windows)) w.readAt = ago(20);
  writeFileSync(accountPath, JSON.stringify(account));
  p.gov('watchdog', 'run');
  assert.equal(runs().length, 1, 'no reading since the last start');
  account.quota.readAt = ago(1);
  writeFileSync(accountPath, JSON.stringify(account));
  p.gov('watchdog', 'run');
  assert.equal(runs().length, 2);
  assert.equal(runs()[1].fill, 1);
  // At the 5-hour cap a scheduled run holds too, once notified, with no alert of its own.
  p.answers(answer(6, 93));
  p.gov('quota');
  p.gov('heartbeat', 'demo');
  assert.match(runs().at(-1).reason, /^governor: 5h 93% ≥ 90%/);
  assert.equal(runs().at(-1).status, 'blocked');
  const status = p.gov('governor', 'status').stdout;
  assert.match(status, /^governor on · target 90%/);
  assert.match(status, /^projects demo$/m);
  assert.match(status, /^cost {5}per run, 7 days: opus 0 pt of 7d \(2 runs\)$/m);
  assert.equal(p.gov('governor', 'off').status, 0);
  assert.match(p.gov('heartbeat', 'fill', 'demo').stdout, /blocked .*governor: off/);
});

test('a fill run leaves alone a project whose slot comes before it would end (D176); no criteria is no reason to stop', () => {
  const news = [{ name: 'news', times: [{ hour: 7, minute: 30 }], days: null }];
  const local = (h, m) => new Date(2026, 9, 29, h, m);
  assert.equal(slotWithin(news, 90, local(6, 47)), true);
  assert.equal(slotWithin(news, 90, local(5, 59)), false);
  assert.equal(slotWithin(news, 90, local(7, 30)), false, 'the slot just started is behind, not ahead');
  assert.equal(slotWithin([{ ...news[0], days: ['fri'] }], 90, local(6, 47)), false, 'not its day');
  assert.equal(slotWithin([{ name: 'h', times: [{ minute: 15 }], days: null }], 90, local(6, 47)), true);
  const prompt = triagePrompt({ plan: { due: [{ name: 'main', goal: null, criteria: null }], implicit: true } });
  assert.match(prompt, /An area with no goal or criteria .* never answer no work for want of criteria/);
});
