// The user's language (D162) and the quota running fast (D164).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { t, userLanguage, leadLanguageLine } from '../src/i18n.js';
import { blockMessage, howLong } from '../src/announce.js';
import { burnWarning } from '../src/quotawatch.js';
import { readyProject } from './sandbox.js';

const H = 3_600_000;

test('every text Jérôme writes to the user exists in Italian too', () => {
  const source = readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8');
  const block = (name) => source.slice(source.indexOf(`  ${name}: {`), source.indexOf('\n  },', source.indexOf(`  ${name}: {`)));
  const keys = (name) => [...block(name).matchAll(/^ {4}'([\w.]+)':/gm)].map((m) => m[1]).sort();
  assert.ok(keys('en').length > 30);
  assert.deepEqual(keys('it'), keys('en'));
});

test('a block is told in the user\'s language, with no path and no runner\'s wording', () => {
  const reason = 'uncommitted changes (README.md) on main, not left by a heartbeat: commit or discard them';
  assert.equal(blockMessage(reason, 'it'), 'Ci sono modifiche tue non salvate (README.md). Fai il commit o scartale, e riparte da solo.');
  assert.equal(howLong({ openedAt: new Date(Date.now() - 7 * H).toISOString(), count: 3 }, new Date(), 'it'), 'Fermo da 7 ore, 3 run perse.');
  assert.equal(blockMessage('resume: x → token cap: 600,000 tokens over 500,000', 'it'), t('block.cap', {}, 'it'));
  assert.equal(t('request.notice', { id: 4, question: 'Quale nome?' }, 'it'), 'Domanda R4: Quale nome?');
  assert.match(leadLanguageLine('it'), /decision requests .* in Italian/);
  assert.equal(leadLanguageLine('en'), null);
});

test('jerome language sets the language over the system\'s, and auto goes back to it', () => {
  const p = readyProject();
  const env = { JEROME_LANGUAGE: '' };
  assert.equal(p.runWith(env, 'language', 'it').status, 0);
  assert.match(p.runWith(env, 'language').stdout, /^it \(Italiano\), set with `jerome language`/);
  assert.deepEqual(JSON.parse(readFileSync(join(p.root, '.config', 'jerome', 'preferences.json'), 'utf8')), { language: 'it' });
  assert.equal(p.runWith(env, 'language', 'tlh').status, 2);
  assert.equal(p.runWith(env, 'language', 'auto').status, 0);
  assert.doesNotMatch(p.runWith(env, 'language').stdout, /set with `jerome language`/);
  assert.deepEqual(userLanguage({ JEROME_LANGUAGE: 'it' }), { code: 'it', source: 'JEROME_LANGUAGE' });
});

test('the user hears when the weekly quota rises by over twice its pace in a day, with when it would run out (D164)', () => {
  const now = new Date('2026-10-29T18:00:00Z');
  const resetsAt = Date.parse('2026-11-04T01:59:59Z') / 1000;
  const reading = (hoursAgo, seven) => ({ at: new Date(now.getTime() - hoursAgo * H).toISOString(), seven, resetsAt });
  // +28 points in 24 hours, against 12.9 a day: at 59% with 41 left, about a day and a half more.
  const fast = [reading(30, 25), reading(24, 31), reading(12, 45), reading(0, 59)];
  assert.equal(burnWarning(fast, { now, code: 'it' }), 'La quota settimanale sta correndo: +28 punti nelle ultime 24 ore (dal 31% al 59%), contro circa 13 al giorno per stare al passo. A questa velocità finisce sabato, prima del reset.');
  assert.match(burnWarning(fast, { now, code: 'en' }), /^The weekly quota is running fast: \+28 points .* runs out on Saturday, before the reset\.$/);
  // At the pace, or with no reading a day old, nothing.
  assert.equal(burnWarning([reading(24, 31), reading(0, 44)], { now }), null);
  assert.equal(burnWarning([reading(6, 10), reading(0, 59)], { now }), null);
  // A reading of the week before its reset is not compared.
  assert.equal(burnWarning([{ ...reading(24, 80), resetsAt: resetsAt - 7 * 86_400 }, reading(0, 40)], { now }), null);
});
