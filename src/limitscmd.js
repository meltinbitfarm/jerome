// `jerome limits [dir]`: shows and sets the usage limits (D83). Global limits are % of the subscription windows, in
// account.json; project limits are API-equivalent dollars per calendar day and week, in .jerome. Without options it
// shows them with the current usage.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MARKER, updateMarker } from './template.js';
import { readAccount, writeAccount, accountPath } from './account.js';
import { openDb, DB_FILE } from './db.js';
import { globalLimits, projectStatus, projectLimitSettings, money, tokensText, limitText, DEFAULT_PROJECT_LIMITS } from './budget.js';

const GLOBAL = { 'five-hour': 'five_hour', 'seven-day': 'seven_day' };
const PROJECT = { daily: 'daily', weekly: 'weekly' };

export async function limits(dirArg, options = {}) {
  const dir = resolve(dirArg);
  const changes = [];
  try {
    for (const [option, key] of Object.entries(GLOBAL)) {
      if (options[option] === undefined) continue;
      const value = parse(options[option], `--${option}`, { max: 100 });
      const account = readAccount();
      account.limits = { ...account.limits };
      if (value === null) delete account.limits[key];
      else account.limits[key] = value;
      writeAccount(account);
      changes.push(`global ${key === 'five_hour' ? '5h' : '7d'} ${value === null ? 'off' : `${value}%`}`);
    }
    const projectOptions = Object.keys(PROJECT).filter((o) => options[o] !== undefined);
    if (projectOptions.length) {
      if (!existsSync(join(dir, MARKER))) throw new Error(`${dir} is not a Jérôme project (the ${MARKER} marker is missing).`);
      for (const option of projectOptions) {
        // "default" removes the project's own value, so the default applies again.
        if (String(options[option]) === 'default') {
          updateMarker(dir, (m) => {
            if (!m.limits) return;
            delete m.limits[PROJECT[option]];
            if (!Object.keys(m.limits).length) delete m.limits;
          });
          changes.push(`project ${option} default ($${DEFAULT_PROJECT_LIMITS[PROJECT[option]]})`);
          continue;
        }
        const value = parse(options[option], `--${option}`);
        updateMarker(dir, (m) => { m.limits = { ...(m.limits ?? {}), [PROJECT[option]]: value }; });
        changes.push(`project ${option} ${value === null ? 'off' : limitText(value)}`);
      }
    }
  } catch (err) {
    console.error(err.message);
    return err.usage ? 2 : 1;
  }
  if (changes.length) console.log(`✓ Limits set: ${changes.join(', ')}`);
  console.log(show(dir));
  return 0;
}

// "off" turns a limit off; otherwise a positive number (a % for global limits, at most 100).
function parse(raw, name, { max } = {}) {
  if (String(raw) === 'off') return null;
  const value = Number(raw);
  if (!(value > 0) || (max && value > max)) {
    const err = new Error(`${name} takes ${max ? 'a percentage from 1 to 100' : 'a positive number of dollars'}, or off.`);
    err.usage = true;
    throw err;
  }
  return value;
}

export function show(dir, now = new Date()) {
  const lines = [];
  const g = globalLimits(now);
  const names = { five_hour: '5h', seven_day: '7d' };
  const account = readAccount();
  for (const key of ['five_hour', 'seven_day']) {
    const w = g.windows[key];
    const limit = account.limits?.[key];
    const used = w ? `${w.used}%${w.stale ? ' (window reset since the last reading)' : ''}` : 'no reading yet';
    lines.push(`global  ${names[key]} ${used} / ${typeof limit === 'number' ? `${limit}%` : 'no limit'}`);
  }
  lines.push(`        in ${accountPath()}`);
  if (existsSync(join(dir, MARKER))) {
    const { problems } = projectLimitSettings(dir);
    const db = existsSync(join(dir, DB_FILE)) ? openDb(dir, { readOnly: true, migrate: false }) : null;
    if (db) {
      try {
        const s = projectStatus(dir, db, now);
        for (const [name, label] of [['daily', 'today'], ['weekly', 'week ']]) {
          const x = s[name];
          lines.push(`project ${label} ${money(x.usd)} API (${tokensText(x.tokens)} tokens) / ${x.limit ? limitText(x.limit) : 'no limit'}`);
        }
      } finally {
        db.close();
      }
    } else lines.push(`project (${DB_FILE} missing: run \`jerome doctor\`)`);
    lines.push(...problems.map((p) => `! ${p}`));
  }
  return lines.join('\n');
}
