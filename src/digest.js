// `jerome digest [dir] [--since 7d]`: the periodic digest (D13, D75), at zero tokens. It puts together the lines the
// lead agent appends to digest.md at the end of each heartbeat and the figures of the project database.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { MARKER } from './template.js';
import { openDb, DB_FILE } from './db.js';
import { n, dollars } from './state.js';
import { callPrice, TIER_SQL } from './models.js';

export const DIGEST = 'digest.md';

export async function digest(dirArg, { since = '7d' } = {}) {
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, MARKER))) {
    console.error(`${dir} is not a Jérôme project (the ${MARKER} marker is missing).`);
    return 1;
  }
  const days = Number(String(since).replace(/d$/, ''));
  if (!Number.isInteger(days) || days <= 0) {
    console.error('--since takes a number of days, such as 7d.');
    return 2;
  }
  const from = new Date(Date.now() - days * 86_400_000);
  console.log(formatDigest(dir, from, days));
  return 0;
}

export function formatDigest(dir, from, days) {
  const out = [`${basename(dir)} · digest of the last ${days} ${days === 1 ? 'day' : 'days'}`];
  const db = openDb(dir, { readOnly: true, migrate: false });
  if (db) {
    try {
      const fromIso = from.toISOString();
      const runs = db.prepare('SELECT kind, status, count(*) n FROM runs WHERE started_at >= ? GROUP BY kind, status ORDER BY kind, status').all(fromIso);
      out.push(`runs      ${runs.length ? runs.map((r) => `${r.n} ${r.kind} ${r.status}`).join(' · ') : 'none'}`);
      let usd = 0;
      let tokens = 0;
      for (const r of db.prepare(`SELECT model, ${TIER_SQL} long_prompt, sum(input) input, sum(output) output, sum(cache_read) cache_read, sum(cache_write_5m) cache_write_5m,
        sum(cache_write_1h) cache_write_1h FROM usage WHERE at >= ? GROUP BY model, long_prompt`).all(fromIso)) {
        tokens += r.input + r.output + r.cache_read + r.cache_write_5m + r.cache_write_1h;
        usd += callPrice(r.model, r) ?? 0;
      }
      out.push(`usage     ${n(tokens)} tokens ${dollars(usd)} API`);
      const opened = db.prepare('SELECT count(*) n FROM requests WHERE opened_at >= ?').get(fromIso).n;
      const open = db.prepare("SELECT count(*) n FROM requests WHERE status = 'open'").get().n;
      out.push(`requests  ${opened} opened · ${open} still open`);
    } finally {
      db.close();
    }
  } else out.push(`(${DB_FILE} missing: no figures)`);
  try {
    const commits = execFileSync('git', ['log', 'main', '--first-parent', '--oneline', `--since=${from.toISOString()}`], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean).length;
    out.push(`main      ${commits} ${commits === 1 ? 'commit' : 'commits'}`);
  } catch {
    // Not a git repository yet, or no main branch.
  }
  const lines = existsSync(join(dir, DIGEST)) ? readFileSync(join(dir, DIGEST), 'utf8').split('\n').filter((l) => /^- \d{4}-\d{2}-\d{2}/.test(l)) : [];
  const recent = lines.filter((l) => l.slice(2, 12) >= from.toISOString().slice(0, 10));
  out.push(recent.length ? 'heartbeats' : 'heartbeats none in the period');
  out.push(...recent.map((l) => `  ${l.slice(2)}`));
  return out.join('\n');
}
