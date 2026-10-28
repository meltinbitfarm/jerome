// The quota running fast (D164): the user hears, once a day at most, when the 7-day window rose in the last 24 hours
// by more than twice the pace that ends the week at its target, with when it would run out at that speed. Only on the
// machine where the Telegram bridge is set up, the user's channel, so several Macs do not say it twice. The watchdog
// keeps a reading every few minutes, for a week, to know where the window was a day ago.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cacheDir } from './runstate.js';
import { refreshQuota } from './quota.js';
import { governorSettings } from './governor.js';
import { readConfig } from './telegram.js';
import { notify } from './notify.js';
import { t, lang, dayName } from './i18n.js';

const DAY_MS = 86_400_000;
// How far back the comparison may reach: a reading between 20 and 28 hours old stands for "a day ago".
const NEAREST_MS = [20 * 3_600_000, 28 * 3_600_000];
const historyPath = () => cacheDir('quota', 'history.json');

function readHistory() {
  try {
    return JSON.parse(readFileSync(historyPath(), 'utf8'));
  } catch {
    return { readings: [], told: null };
  }
}

function writeHistory(h) {
  mkdirSync(dirname(historyPath()), { recursive: true });
  writeFileSync(historyPath(), JSON.stringify(h));
}

// The warning, or null: given the readings [{ at, seven, resetsAt }] and the target of the week.
export function burnWarning(readings, { now = new Date(), target = 90, code = lang() } = {}) {
  const last = readings.at(-1);
  if (!last || now.getTime() - Date.parse(last.at) > 30 * 60_000) return null;
  const before = readings.filter((r) => r.resetsAt === last.resetsAt)
    .filter((r) => { const age = Date.parse(last.at) - Date.parse(r.at); return age >= NEAREST_MS[0] && age <= NEAREST_MS[1]; })
    .sort((a, b) => Math.abs(Date.parse(last.at) - Date.parse(a.at) - DAY_MS) - Math.abs(Date.parse(last.at) - Date.parse(b.at) - DAY_MS))[0];
  if (!before) return null;
  const hours = (Date.parse(last.at) - Date.parse(before.at)) / 3_600_000;
  const rise = Math.round(((last.seven - before.seven) * 24) / hours);
  const pace = Math.round((target / 7) * 10) / 10;
  if (rise < 2 * pace) return null;
  const reset = new Date(last.resetsAt * 1000);
  const out = new Date(Date.parse(last.at) + ((100 - last.seven) / rise) * DAY_MS);
  const end = out < reset ? t('quota.out', { day: dayName(out, code) }, code) : t('quota.reset', { day: dayName(reset, code) }, code);
  return `${t('quota.burn', { rise, from: before.seven, to: last.seven, pace: Math.round(pace) }, code)}${end}`;
}

// Every minute, from the watchdog.
export async function quotaWatch({ env = process.env, now = new Date(), log = () => {} } = {}) {
  if (!readConfig()) return null;
  const account = await refreshQuota({ env, now });
  const week = account.windows?.seven_day;
  const h = readHistory();
  if (week?.readAt && week.resetsAt && h.readings.at(-1)?.at !== week.readAt) {
    h.readings.push({ at: week.readAt, seven: week.used, resetsAt: week.resetsAt });
  }
  h.readings = h.readings.filter((r) => now.getTime() - Date.parse(r.at) <= 8 * DAY_MS);
  const code = lang(env);
  const warning = h.told && now.getTime() - Date.parse(h.told) < DAY_MS ? null : burnWarning(h.readings, { now, target: governorSettings(account).target, code });
  if (warning) {
    h.told = now.toISOString();
    log(`quota: ${warning}`);
    notify(env, null, warning);
  }
  writeHistory(h);
  return warning;
}
