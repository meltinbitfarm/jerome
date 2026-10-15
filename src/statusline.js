// `jerome statusline` (D23, D60): the project's status line. It records the subscription windows in account.json
// when they change, runs the user's own status line with the same input if there is one, and appends Jérôme's
// part. It never fails: whatever goes wrong, it prints what it can.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { claudeConfigDir } from './claude.js';
import { MARKER } from './template.js';
import { recordWindows, readAccount, WINDOWS } from './account.js';
import { openDb } from './db.js';
import { callPrice } from './models.js';

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
    const account = readAccount();
    const windows = WINDOWS.filter((w) => account.windows[w]).map((w) => `${w === 'five_hour' ? '5h' : '7d'} ${account.windows[w].used}%`);
    parts.push(...windows);
  } catch {
    // Without account data the line shows the rest.
  }
  const dir = env.CLAUDE_PROJECT_DIR ?? data.workspace?.project_dir ?? data.cwd;
  try {
    const cost = dir && existsSync(join(dir, MARKER)) ? todayApiUsd(dir) : null;
    if (cost) parts.push(`today ${cost}`);
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

// Today's usage of the project at API prices, labelled as such (D57).
function todayApiUsd(dir) {
  const db = openDb(dir, { migrate: false });
  if (!db) return null;
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = db.prepare(`SELECT model, sum(input) input, sum(output) output, sum(cache_read) cache_read,
      sum(cache_write_5m) cache_write_5m, sum(cache_write_1h) cache_write_1h FROM usage WHERE at >= ? GROUP BY model`).all(start.toISOString());
    if (!rows.length) return null;
    let usd = 0;
    let unpriced = false;
    for (const r of rows) {
      const p = callPrice(r.model, r);
      if (p === null) unpriced = true;
      else usd += p;
    }
    return `≈$${usd.toFixed(2)}${unpriced ? '+?' : ''} API`;
  } finally {
    db.close();
  }
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
