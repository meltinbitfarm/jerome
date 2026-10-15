// `jerome state [dir]`: what the lead agent reads about usage, runs and decision requests (D57). Compact on
// purpose, about 150 tokens, since it ends up in the lead agent's context. Dollar amounts are API equivalents
// (D20): a subscription is not billed per token.
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { MARKER } from './template.js';
import { openDb, schemaVersion, DbTooNewError, LATEST } from './db.js';
import { projectAgents } from './agents.js';
import { projectStatus, projectOver, projectSummary, globalLimits } from './budget.js';
import { callPrice, TIER_SQL } from './models.js';
import { readAccount, WINDOWS } from './account.js';
import { notProjectMessage } from './paths.js';

export const STATE_SCHEMA = 'jerome.state/v1';

export async function state(dirArg, { json = false, runs = 3, agent = null, replies = false } = {}) {
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, MARKER))) {
    console.error(notProjectMessage(dir));
    return 1;
  }
  let report;
  try {
    report = readState(dir, { runs, agent });
  } catch (err) {
    console.error(err instanceof DbTooNewError ? err.message : `Cannot read the project state: ${err.message}`);
    return 1;
  }
  if (!report) {
    console.error(`The project database is missing: run \`jerome doctor\` to create it.`);
    return 1;
  }
  console.log(json ? JSON.stringify(report, null, 2) : formatState(report, { replies }));
  return 0;
}

const SUMS = `sum(input) input, sum(output) output, sum(cache_read) cache_read,
  sum(cache_write_5m) cache_write_5m, sum(cache_write_1h) cache_write_1h, count(*) calls`;

// Everything `jerome state` knows about a project. The text output shows a compact part; `--json` and the viewer
// (D66) get all of it. With readOnly the database is opened without migrations and never written (D65).
export function readState(dir, { runs = 3, agent = null, readOnly = false, now = new Date(), account = readAccount() } = {}) {
  const db = openDb(dir, readOnly ? { readOnly: true, migrate: false } : {});
  if (!db) return null;
  try {
    if (readOnly && schemaVersion(db) < LATEST) throw new Error(`The project database is at schema ${schemaVersion(db)} of ${LATEST}: run \`jerome doctor\``);
    const since = {
      today: startOfLocalDay(now).toISOString(),
      week: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
      month: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
    };
    const filter = agent ? ' AND agent = ?' : '';
    const args = (from) => (agent ? [from, agent] : [from]);
    const rows = (from) => db.prepare(`SELECT model, agent, ${TIER_SQL} long_prompt, ${SUMS} FROM usage WHERE at >= ?${filter} GROUP BY model, agent, long_prompt`).all(...args(from));

    const periods = Object.fromEntries(Object.entries(since).map(([name, from]) => [name, rows(from)]));
    const agents = new Map();
    for (const r of periods.week) agents.set(r.agent, total([agents.get(r.agent) ?? total([]), totals([r])]));

    const recent = db.prepare('SELECT id, session_id, kind, status, started_at, ended_at, reason FROM runs ORDER BY started_at DESC LIMIT ?').all(runs);
    const perRun = db.prepare(`SELECT agent, model, ${TIER_SQL} long_prompt, ${SUMS} FROM usage WHERE run_id = ? GROUP BY agent, model, long_prompt`);
    const requests = db.prepare(`SELECT id, run_id, question, options, recommendation, opened_at FROM requests WHERE status = 'open' ORDER BY opened_at`).all();

    return {
      schema: STATE_SCHEMA,
      project: basename(dir),
      at: now.toISOString(),
      agent,
      usage: { today: totals(periods.today), week: totals(periods.week), month: totals(periods.month) },
      // Usage per agent and model, for each period.
      byModel: Object.fromEntries(Object.entries(periods).map(([name, list]) => [name, list
        .map((r) => ({ agent: r.agent, model: r.model, ...totals([r]) }))
        .sort((a, b) => b.tokens - a.tokens)])),
      agents: [...agents].map(([name, t]) => ({ agent: name, ...t })).sort((a, b) => b.tokens - a.tokens),
      team: team(dir, periods.month),
      windows: Object.fromEntries(WINDOWS.filter((w) => account.windows[w]).map((w) => [w, account.windows[w]])),
      limits: account.limits,
      // The project's limits and spend in each calendar window (D82, D86).
      projectLimits: projectStatus(dir, db, now),
      runs: recent.map((r) => {
        const usage = perRun.all(r.id);
        const t = totals(usage);
        return {
          id: r.id, sessionId: r.session_id, kind: r.kind, status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
          durationMs: r.ended_at ? Date.parse(r.ended_at) - Date.parse(r.started_at) : null, reason: r.reason,
          tokens: t.tokens, calls: t.calls, apiUsd: t.apiUsd, unpriced: t.unpriced, agents: [...new Set(usage.map((u) => u.agent))],
        };
      }),
      requests: requests.map((r) => ({ id: r.id, runId: r.run_id, question: r.question, options: r.options, recommendation: r.recommendation, openedAt: r.opened_at })),
      replies: replyStats(db, since.week, agent),
    };
  } finally {
    db.close();
  }
}

// The lead agent and its subagents (D66): the agents declared in .claude/agents/, and the ones that appear in the
// usage of the last 30 days without a file (built-in agents such as general-purpose).
function team(dir, monthRows) {
  const models = new Map();
  for (const r of monthRows) models.set(r.agent, [...new Set([...(models.get(r.agent) ?? []), r.model])]);
  const declared = projectAgents(dir).map((a) => ({
    agent: a.meta.name || a.file.replace(/\.md$/, ''),
    model: a.meta.model ?? null,
    tools: (a.meta.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    description: a.meta.description ?? null,
    source: 'project',
  }));
  const names = new Set(declared.map((a) => a.agent));
  const seen = [...models.keys()].filter((name) => name !== 'main' && !names.has(name)).sort()
    .map((name) => ({ agent: name, model: null, tools: [], description: null, source: 'built-in' }));
  return {
    lead: { agent: 'main', models: models.get('main') ?? [] },
    subagents: [...declared, ...seen].map((a) => ({ ...a, models: models.get(a.agent) ?? [] })),
  };
}

// Reply lengths of the subagents over the period (D62), from the subagent-stop events, per agent.
export const REPLY_LIMIT = 150;

function replyStats(db, since, agent) {
  const rows = db.prepare(`SELECT agent, data FROM events WHERE kind = 'subagent-stop' AND coalesce(agent, '') != '' AND at >= ?${agent ? ' AND agent = ?' : ''}`)
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
// Cache reads and writes are kept apart: on the API a read costs a tenth of an input token, a write more than one.
// `cache` stays as their sum, for readers of jerome.state/v1. apiUsd keeps four decimals, so amounts below a cent
// still show as such.
function totals(rows) {
  const t = { tokens: 0, input: 0, output: 0, cache: 0, cacheRead: 0, cacheWrite: 0, calls: 0, apiUsd: 0, unpriced: false };
  for (const r of rows) {
    const write = r.cache_write_5m + r.cache_write_1h;
    const cache = r.cache_read + write;
    t.input += r.input;
    t.output += r.output;
    t.cache += cache;
    t.cacheRead += r.cache_read;
    t.cacheWrite += write;
    t.tokens += r.input + r.output + cache;
    t.calls += r.calls;
    const price = callPrice(r.model, r);
    if (price === null) t.unpriced = true;
    else t.apiUsd += price;
  }
  t.apiUsd = Math.round(t.apiUsd * 10000) / 10000;
  return t;
}

function total(parts) {
  const t = { tokens: 0, input: 0, output: 0, cache: 0, cacheRead: 0, cacheWrite: 0, calls: 0, apiUsd: 0, unpriced: false };
  for (const p of parts) {
    for (const k of ['tokens', 'input', 'output', 'cache', 'cacheRead', 'cacheWrite', 'calls', 'apiUsd']) t[k] += p[k];
    t.unpriced ||= p.unpriced;
  }
  t.apiUsd = Math.round(t.apiUsd * 10000) / 10000;
  return t;
}

export function formatState(s, { replies = false } = {}) {
  const now = new Date(s.at);
  const lines = [`${s.project}${s.agent ? ` · agent ${s.agent}` : ''} · state at ${when(s.at, now, true)}`];
  const { today, week } = s.usage;
  lines.push(`usage   today ${n(today.tokens)} (in ${n(today.input)} · out ${n(today.output)} · cache read ${n(today.cacheRead)} · write ${n(today.cacheWrite)}) ${usd(today)} · 7d ${n(week.tokens)} ${usd(week)}`);
  const windows = Object.entries(s.windows);
  const limits = WINDOWS.filter((w) => s.limits[w] !== undefined).map((w) => `${s.limits[w]}%`);
  if (windows.length) {
    const latest = windows.map(([, w]) => w).sort((a, b) => b.readAt.localeCompare(a.readAt))[0];
    const parts = windows.map(([name, w]) => `${name === 'five_hour' ? '5h' : '7d'} ${w.used}%`);
    lines.push(`window  ${parts.join(' · ')} (${latest.source}, ${when(latest.readAt, now)})${limits.length ? ` · global limits ${limits.join(' / ')}` : ''}`);
  } else lines.push('window  no reading yet');
  if (s.projectLimits) lines.push(`limits  ${projectSummary(s.projectLimits)} API`);
  // Heartbeats are paused while a limit is reached (D84); they start again when its window resets.
  const paused = (s.projectLimits && projectOver(s.projectLimits)) || globalLimits(now, { windows: s.windows, limits: s.limits }).over;
  if (paused) lines.push(`paused  heartbeats: ${typeof paused === 'string' ? paused : paused.reason}`);
  if (!s.agent) lines.push(`agents  7d: ${s.agents.length ? s.agents.map((a) => `${a.agent} ${n(a.tokens)}`).join(' · ') : 'none'}`);
  lines.push(`runs    ${s.runs.length ? `last ${s.runs.length}: ${s.runs.map((r) => `${when(r.startedAt, now)} ${r.kind} ${r.status}${r.reason && r.status !== 'done' ? ` (${r.reason})` : ''} ${n(r.tokens)}`).join(' · ')}` : 'none'}`);
  if (replies) {
    lines.push(`replies 7d: ${s.replies.length ? s.replies.map((r) => `${r.agent} avg ${r.average}w max ${r.max} (${r.over}/${r.replies} over ${REPLY_LIMIT})`).join(' · ') : 'none recorded'}`);
  }
  lines.push(`open    ${s.requests.length ? s.requests.map((r) => `R${r.id} ${r.question} (${when(r.openedAt, now)})`).join(' · ') : 'no decision requests'}`);
  // The lead agent learns how to close a request where it reads it, at no cost to CLAUDE.md (D74).
  if (s.requests.length) lines.push('        propose them to the user; record each answer with `jerome request answer <id> "<answer>"`, or `jerome request drop <id>`');
  return lines.join('\n');
}

// "≈$3.40 API", with a "+?" when some calls used a model without a known price.
function usd(t) {
  return `${dollars(t.apiUsd)}${t.unpriced ? '+?' : ''} API`;
}

// "≈$3.40", "<$0.01" for amounts above zero but below a cent, "$0.00" for nothing.
export function dollars(value) {
  if (value > 0 && value < 0.005) return '<$0.01';
  return value === 0 ? '$0.00' : `≈$${value.toFixed(2)}`;
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
