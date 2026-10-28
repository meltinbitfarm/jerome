// `jerome statusline` (D23, D60): the project's status line. It records the subscription windows in account.json
// when they change, runs the user's own status line with the same input if there is one, and appends Jérôme's
// part. It never fails: whatever goes wrong, it prints what it can.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { claudeConfigDir } from './claude.js';
import { MARKER } from './template.js';
import { recordWindows, WINDOWS } from './account.js';
import { openDb, dbPath } from './db.js';
import { projectStatus, globalLimits, money, limitText } from './budget.js';
import { lockHolder } from './runstate.js';

export const STATUSLINE_COMMAND = 'jerome statusline';

export async function statusline({ input = readStdin(), env = process.env } = {}) {
  let data = {};
  try {
    data = JSON.parse(input || '{}');
  } catch {
    // An unreadable input still gets a status line.
  }
  const parts = [];
  try {
    const reading = {};
    for (const name of WINDOWS) {
      const w = data.rate_limits?.[name];
      if (w && typeof w.used_percentage === 'number') reading[name] = { used: Math.round(w.used_percentage), resetsAt: w.resets_at ?? null };
    }
    if (Object.keys(reading).length) recordWindows(reading, { source: 'statusline' });
    // Each window with its global limit, coloured by how close it is (D84): "7d 20%/75%".
    for (const [name, w] of Object.entries(globalLimits().windows)) {
      if (w.stale) continue;
      parts.push(paint(`${name === 'five_hour' ? '5h' : '7d'} ${w.used}%${w.limit ? `/${w.limit}%` : ''}`, w.level));
    }
  } catch {
    // Without account data the line shows the rest.
  }
  const dir = env.CLAUDE_PROJECT_DIR ?? data.workspace?.project_dir ?? data.cwd;
  try {
    const project = dir && existsSync(join(dir, MARKER));
    // A project without its database records nothing (D93): it may have moved, and doctor relinks it.
    if (project && !existsSync(dbPath(dir))) parts.push(paint('no database: run jerome doctor', 'over'));
    // What waits for the user (D137), first: the heartbeat alerts in red, the decision requests in yellow; and a
    // heartbeat running, during which the hook refuses commits here (D122).
    const waiting = project ? waitingFor(dir) : null;
    const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
    const first = [waiting?.alerts ? paint(plural(waiting.alerts, 'alert'), 'high') : null, waiting?.requests ? paint(plural(waiting.requests, 'request'), 'warn') : null].filter(Boolean);
    if (first.length) parts.unshift(`⚠ ${first.join(' · ')}`);
    if (project && lockHolder(dir)) parts.push('♥ heartbeat running');
    const status = project ? projectToday(dir) : null;
    if (status) parts.push(paint(`today ${money(status.usd)}${status.limit ? `/${limitText(status.limit)}` : ''} API`, status.level));
  } catch {
    // Without the database the line shows the rest.
  }
  const own = parts.join(' · ');
  const personal = personalLine(input, env);
  const line = personal ? (own ? `${personal} · ${own}` : personal) : own;
  if (line) process.stdout.write(`${line}\n`);
  return 0;
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Today's usage of the project at API prices, labelled as such (D57), against its daily limit (D82).
function projectToday(dir) {
  const db = openDb(dir, { readOnly: true, migrate: false });
  if (!db) return null;
  try {
    const daily = projectStatus(dir, db).daily;
    return daily.tokens ? daily : null;
  } finally {
    db.close();
  }
}

// The open alerts and decision requests, read only; a database from before alerts has none.
function waitingFor(dir) {
  const db = openDb(dir, { readOnly: true, migrate: false });
  if (!db) return null;
  try {
    const count = (sql) => {
      try {
        return db.prepare(sql).get().n;
      } catch {
        return 0;
      }
    };
    return { alerts: count("SELECT count(*) n FROM alerts WHERE status = 'open'"), requests: count("SELECT count(*) n FROM requests WHERE status = 'open'") };
  } finally {
    db.close();
  }
}

// ANSI colours by level, as in the viewer: green, yellow from 75%, red from 90%, bold red beyond the limit.
const COLOURS = { ok: '32', warn: '33', high: '31', over: '1;31' };
function paint(text, lvl) {
  return lvl ? `\x1b[${COLOURS[lvl]}m${text}\x1b[0m` : text;
}

// The user's own status line from their user settings, run with the same input. Jérôme's own command is skipped,
// so it never calls itself. Its last line gets Jérôme's part appended; other lines are kept as they are.
function personalLine(input, env) {
  let command;
  try {
    const settings = JSON.parse(readFileSync(join(claudeConfigDir(), 'settings.json'), 'utf8'));
    command = settings.statusLine?.type === 'command' ? settings.statusLine.command : null;
  } catch {
    return null;
  }
  if (!command || command.includes(STATUSLINE_COMMAND)) return null;
  const r = spawnSync('/bin/sh', ['-c', command], { input, encoding: 'utf8', timeout: 1000, env });
  const out = (r.stdout ?? '').replace(/\s+$/, '');
  return out || null;
}
