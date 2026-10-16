// Usage limits (D12, D82, D84). Project limits are in API-equivalent dollars, the closest measure of subscription
// quota: tokens are mostly cache reads, which cost a tenth of an input token. They cover calendar windows, the day
// from local midnight and the week from Monday 00:00, so a pause ends at a clear moment. Global limits are % of the
// subscription windows, from account.json. A pause is not stored: it is what the check finds at that moment, so
// heartbeats start again by themselves once a window resets.
import { readMarker } from './template.js';
import { readAccount, WINDOWS } from './account.js';
import { callPrice, TIER_SQL } from './models.js';

export const DEFAULT_PROJECT_LIMITS = { daily: 5, weekly: 20 };
const STALE_READING_HOURS = 3;
const NAMES = { five_hour: '5h', seven_day: '7d', daily: 'today', weekly: 'this week' };

// A value's level against its limit, the same everywhere (viewer, status line, state): ok below 75%, warn up to
// 90%, high from 90%, over from 100%.
export function level(used, limit) {
  if (typeof limit !== 'number' || limit <= 0) return null;
  const r = used / limit;
  return r >= 1 ? 'over' : r >= 0.9 ? 'high' : r >= 0.75 ? 'warn' : 'ok';
}

// The project's limits: the defaults, overridden by `limits` in .jerome, where null turns one off. Invalid entries
// are reported and the default applies.
export function projectLimitSettings(dir) {
  const limits = { ...DEFAULT_PROJECT_LIMITS };
  const problems = [];
  let custom;
  try {
    custom = readMarker(dir).limits;
  } catch {
    return { limits, problems };
  }
  if (custom === undefined) return { limits, problems };
  if (typeof custom !== 'object' || custom === null || Array.isArray(custom)) {
    return { limits, problems: ['.jerome: "limits" must be an object such as { "daily": 5, "weekly": 20 }; the defaults apply.'] };
  }
  for (const [key, value] of Object.entries(custom)) {
    if (!(key in DEFAULT_PROJECT_LIMITS)) problems.push(`.jerome: no limit is called "${key}"; limits are daily and weekly.`);
    else if (value === null) limits[key] = null;
    else if (typeof value !== 'number' || !(value > 0)) problems.push(`.jerome: the ${key} limit must be a positive number of dollars, or null to turn it off; the default ($${DEFAULT_PROJECT_LIMITS[key]}) applies.`);
    else limits[key] = value;
  }
  return { limits, problems };
}

// The calendar windows at a moment, in local time.
export function calendarWindows(now = new Date()) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const monday = new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7));
  const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  return { daily: { from: day, resetsAt: nextDay }, weekly: { from: monday, resetsAt: nextMonday } };
}

// The project's spend in each window: dollars at API prices, tokens beside them, the limit and its level.
export function projectStatus(dir, db, now = new Date()) {
  const { limits } = projectLimitSettings(dir);
  const windows = calendarWindows(now);
  const status = {};
  for (const [name, w] of Object.entries(windows)) {
    let usd = 0;
    let tokens = 0;
    for (const r of db.prepare(`SELECT model, ${TIER_SQL} long_prompt, sum(input) input, sum(output) output, sum(cache_read) cache_read, sum(cache_write_5m) cache_write_5m,
      sum(cache_write_1h) cache_write_1h FROM usage WHERE at >= ? GROUP BY model, long_prompt`).all(w.from.toISOString())) {
      tokens += r.input + r.output + r.cache_read + r.cache_write_5m + r.cache_write_1h;
      usd += callPrice(r.model, r) ?? 0;
    }
    const limit = limits[name];
    status[name] = { limit, usd: Math.round(usd * 10000) / 10000, tokens, since: w.from.toISOString(), resetsAt: w.resetsAt.toISOString(), level: level(usd, limit) };
  }
  return status;
}

// The subscription windows against their global limits (D73): a reading whose window has reset says nothing about
// now; one older than 3 hours is named. Returns { over, note, windows }.
export function globalLimits(now = new Date(), account = readAccount()) {
  let note = null;
  let over = null;
  const windows = {};
  for (const w of WINDOWS) {
    const reading = account.windows?.[w];
    const limit = account.limits?.[w];
    if (!reading) continue;
    const reset = Boolean(reading.resetsAt) && reading.resetsAt * 1000 <= now.getTime();
    windows[w] = { used: reading.used, limit: typeof limit === 'number' ? limit : null, readAt: reading.readAt, resetsAt: reading.resetsAt ?? null, stale: Boolean(reset), level: reset ? null : level(reading.used, limit) };
    if (typeof limit !== 'number' || reset) continue;
    const hours = Math.floor((now.getTime() - Date.parse(reading.readAt)) / 3_600_000);
    const age = hours >= STALE_READING_HOURS ? `reading from ${hours} h ago` : null;
    if (reading.used >= limit && !over) over = `global limit: ${NAMES[w]} ${reading.used}% ≥ ${limit}%${age ? ` (${age})` : ''}`;
    else if (age) note = `limits checked on a ${age}`;
  }
  return { over, note, windows };
}

// A limit as written: "$5", "$0.10".
export const limitText = (v) => `$${Number.isInteger(v) ? v : v.toFixed(2)}`;
const money = (v) => (v > 0 && v < 0.005 ? '<$0.01' : v === 0 ? '$0.00' : `≈$${v.toFixed(2)}`);
const tokensText = (t) => (t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${Math.round(t / 1e3)}k` : String(t));

// The first project window at or over its limit, as a pause reason, or null.
export function projectOver(status) {
  for (const name of ['daily', 'weekly']) {
    const s = status[name];
    if (s.limit && s.usd >= s.limit) {
      const when = name === 'daily' ? 'resets at midnight' : 'resets on Monday';
      return { key: `${name}:${s.since}`, reason: `project limit: ${NAMES[name]} ${money(s.usd)} / ${limitText(s.limit)} API (${tokensText(s.tokens)} tokens), ${when}` };
    }
  }
  return null;
}

// "today ≈$2.50/$5 · this week ≈$3.36/$20", for state, the status line and warnings.
export function projectSummary(status) {
  return ['daily', 'weekly'].map((name) => {
    const s = status[name];
    return `${NAMES[name]} ${money(s.usd)}${s.limit ? `/${limitText(s.limit)}` : ''}`;
  }).join(' · ');
}

export { money, tokensText };
