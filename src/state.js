// `jerome state [dir]`: what the lead agent reads about usage, runs and decision requests (D57). Compact on
// purpose, about 150 tokens, since it ends up in the lead agent's context. Dollar amounts are API equivalents
// (D20): a subscription is not billed per token.
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { MARKER } from './template.js';
import { openDb, DbTooNewError, DB_FILE } from './db.js';
import { callPrice } from './models.js';
import { readAccount, WINDOWS } from './account.js';

export const STATE_SCHEMA = 'jerome.state/v1';

export async function state(dirArg, { json = false, runs = 3, agent = null, replies = false } = {}) {
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, MARKER))) {
    console.error(`${dir} is not a Jérôme project (the ${MARKER} marker is missing).`);
    return 1;
  }
  let report;
  try {
    report = readState(dir, { runs, agent, replies });
  } catch (err) {
    console.error(err instanceof DbTooNewError ? err.message : `Cannot read the project state: ${err.message}`);
    return 1;
  }
  if (!report) {
    console.error(`${DB_FILE} is missing: run \`jerome doctor\` to create it.`);
    return 1;
  }
  console.log(json ? JSON.stringify(report, null, 2) : formatState(report));
  return 0;
}

export function readState(dir, { runs = 3, agent = null, replies = false, now = new Date(), account = readAccount() } = {}) {
  const db = openDb(dir);
  if (!db) return null;
  try {
    const today = startOfLocalDay(now).toISOString();
    const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const filter = agent ? ' AND agent = ?' : '';
    const args = (since) => (agent ? [since, agent] : [since]);
    const rows = (since) => db.prepare(`SELECT model, agent, sum(input) input, sum(output) output, sum(cache_read) cache_read,
      sum(cache_write_5m) cache_write_5m, sum(cache_write_1h) cache_write_1h, count(*) calls
      FROM usage WHERE at >= ?${filter} GROUP BY model, agent`).all(...args(since));

    const weekRows = rows(week);
    const agents = new Map();
    for (const r of weekRows) {
      const a = agents.get(r.agent) ?? total([]);
      agents.set(r.agent, total([a, totals([r])]));
    }
    const recent = db.prepare(`SELECT r.id, r.kind, r.status, r.started_at, r.reason,
      (SELECT coalesce(sum(input + output + cache_read + cache_write_5m + cache_write_1h), 0) FROM usage u WHERE u.run_id = r.id) tokens
      FROM runs r ORDER BY r.started_at DESC LIMIT ?`).all(runs);
    const requests = db.prepare(`SELECT id, question, opened_at FROM requests WHERE status = 'open' ORDER BY opened_at`).all();

    const report = {
      schema: STATE_SCHEMA,
      project: basename(dir),
      at: now.toISOString(),
      agent,
      usage: { today: totals(rows(today)), week: totals(weekRows) },
      agents: [...agents].map(([name, t]) => ({ agent: name, ...t })).sort((a, b) => b.tokens - a.tokens),
      windows: Object.fromEntries(WINDOWS.filter((w) => account.windows[w]).map((w) => [w, account.windows[w]])),
      limits: account.limits,
      runs: recent.map((r) => ({ id: r.id, kind: r.kind, status: r.status, startedAt: r.started_at, reason: r.reason, tokens: r.tokens })),
      requests: requests.map((r) => ({ id: r.id, question: r.question, openedAt: r.opened_at })),
    };
    if (replies) report.replies = replyStats(db, week, agent);
    return report;
  } finally {
    db.close();
  }
}

// Reply lengths of the subagents over the period (D62), from the subagent-stop events, per agent.
export const REPLY_LIMIT = 150;

function replyStats(db, since, agent) {
  const rows = db.prepare(`SELECT agent, data FROM events WHERE kind = 'subagent-stop' AND at >= ?${agent ? ' AND agent = ?' : ''}`)
    .all(...(agent ? [since, agent] : [since]));
  const by = new Map();
  for (const r of rows) {
    let words;
    try {
      words = JSON.parse(r.data).words;
    } catch {
      continue;
    }
    if (typeof words !== 'number') continue;
    (by.get(r.agent) ?? by.set(r.agent, []).get(r.agent)).push(words);
  }
  return [...by].map(([name, w]) => ({
    agent: name,
    replies: w.length,
    average: Math.round(w.reduce((a, b) => a + b, 0) / w.length),
    max: Math.max(...w),
    over: w.filter((x) => x > REPLY_LIMIT).length,
  })).sort((a, b) => a.agent.localeCompare(b.agent));
}

// Sums usage rows: tokens of every kind, the API-equivalent price, and whether some model had no known price.
function totals(rows) {
  const t = { tokens: 0, input: 0, output: 0, cache: 0, calls: 0, apiUsd: 0, unpriced: false };
  for (const r of rows) {
    const cache = r.cache_read + r.cache_write_5m + r.cache_write_1h;
    t.input += r.input;
    t.output += r.output;
    t.cache += cache;
    t.tokens += r.input + r.output + cache;
    t.calls += r.calls;
    const price = callPrice(r.model, r);
    if (price === null) t.unpriced = true;
    else t.apiUsd += price;
  }
  t.apiUsd = Math.round(t.apiUsd * 100) / 100;
  return t;
}

function total(parts) {
  const t = { tokens: 0, input: 0, output: 0, cache: 0, calls: 0, apiUsd: 0, unpriced: false };
  for (const p of parts) {
    for (const k of ['tokens', 'input', 'output', 'cache', 'calls', 'apiUsd']) t[k] += p[k];
    t.unpriced ||= p.unpriced;
  }
  t.apiUsd = Math.round(t.apiUsd * 100) / 100;
  return t;
}

export function formatState(s) {
  const now = new Date(s.at);
  const lines = [`${s.project}${s.agent ? ` · agent ${s.agent}` : ''} · state at ${when(s.at, now, true)}`];
  const { today, week } = s.usage;
  lines.push(`usage   today ${n(today.tokens)} (in ${n(today.input)} · out ${n(today.output)} · cache ${n(today.cache)}) ${usd(today)} · 7d ${n(week.tokens)} ${usd(week)}`);
  const windows = Object.entries(s.windows);
  const limits = WINDOWS.filter((w) => s.limits[w] !== undefined).map((w) => `${s.limits[w]}%`);
  if (windows.length) {
    const latest = windows.map(([, w]) => w).sort((a, b) => b.readAt.localeCompare(a.readAt))[0];
    const parts = windows.map(([name, w]) => `${name === 'five_hour' ? '5h' : '7d'} ${w.used}%`);
    lines.push(`window  ${parts.join(' · ')} (${latest.source}, ${when(latest.readAt, now)})${limits.length ? ` · global limits ${limits.join(' / ')}` : ''}`);
  } else lines.push('window  no reading yet');
  if (!s.agent) lines.push(`agents  7d: ${s.agents.length ? s.agents.map((a) => `${a.agent} ${n(a.tokens)}`).join(' · ') : 'none'}`);
  lines.push(`runs    ${s.runs.length ? `last ${s.runs.length}: ${s.runs.map((r) => `${when(r.startedAt, now)} ${r.kind} ${r.status}${r.reason && r.status !== 'done' ? ` (${r.reason})` : ''} ${n(r.tokens)}`).join(' · ')}` : 'none'}`);
  if (s.replies) {
    lines.push(`replies 7d: ${s.replies.length ? s.replies.map((r) => `${r.agent} avg ${r.average}w max ${r.max} (${r.over}/${r.replies} over ${REPLY_LIMIT})`).join(' · ') : 'none recorded'}`);
  }
  lines.push(`open    ${s.requests.length ? s.requests.map((r) => `R${r.id} ${r.question} (${when(r.openedAt, now)})`).join(' · ') : 'no decision requests'}`);
  return lines.join('\n');
}

// "≈$3.40 API", with a "+?" when some calls used a model without a known price.
function usd(t) {
  return `≈$${t.apiUsd.toFixed(2)}${t.unpriced ? '+?' : ''} API`;
}

// 950 → "950", 12_300 → "12k", 2_140_000 → "2.1M".
export function n(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`;
  return String(value);
}

// Local time: "14:02" today, "15/10 14:02" on other days.
function when(iso, now, full = false) {
  const d = new Date(iso);
  const pad = (x) => String(x).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (full) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
  return startOfLocalDay(d).getTime() === startOfLocalDay(now).getTime() ? time : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time}`;
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
