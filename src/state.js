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
import { notProjectHint } from './paths.js';
import { readAreas, agentAreas } from './areas.js';
import { readAssumptions } from './assumptions.js';
import { openAlerts, lostRuns } from './alerts.js';
import { openNotes } from './notes.js';
import { GROUPS } from './limits.js';
import { unlocked } from './unlocked.js';
import { pushPending } from './push.js';

export const STATE_SCHEMA = 'jerome.state/v1';

export async function state(dirArg, { json = false, runs = 3, agent = null, replies = false } = {}) {
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, MARKER))) {
    console.error(notProjectHint(dir));
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

    const recent = db.prepare('SELECT id, session_id, kind, status, started_at, ended_at, reason, area, triage, caps, mode, slot, exit_code, outcome FROM runs ORDER BY started_at DESC LIMIT ?').all(runs);
    const perRun = db.prepare(`SELECT agent, model, ${TIER_SQL} long_prompt, ${SUMS} FROM usage WHERE run_id = ? GROUP BY agent, model, long_prompt`);
    const heartbeat = db.prepare("SELECT id, status, started_at, ended_at, reason, area, caps FROM runs WHERE kind = 'heartbeat' ORDER BY started_at DESC LIMIT 1").get();
    const requests = db.prepare(`SELECT id, run_id, question, options, recommendation, opened_at, area, kind FROM requests WHERE status = 'open' ORDER BY opened_at`).all();
    const areas = areaUsage(dir, db, since.week, requests);

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
      // A reading whose window has reset since says nothing about now: it is marked stale, never shown as current.
      windows: Object.fromEntries(WINDOWS.filter((w) => account.windows[w]).map((w) => [w, { ...account.windows[w], stale: isReset(account.windows[w], now) }])),
      limits: account.limits,
      // The areas with their milestone, last heartbeat, open request and 7-day usage; the rest is shared (D101, D102).
      areas: areas.areas,
      areasImplicit: areas.implicit,
      shared: areas.shared,
      // The project's limits and spend in each calendar window (D82, D86).
      projectLimits: projectStatus(dir, db, now),
      runs: recent.map((r) => {
        const usage = perRun.all(r.id);
        const t = totals(usage);
        return {
          id: r.id, sessionId: r.session_id, kind: r.kind, area: r.area, triage: parseJson(r.triage), caps: parseJson(r.caps), status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
          mode: r.mode, slot: r.slot, exitCode: r.exit_code, outcome: parseJson(r.outcome),
          durationMs: r.ended_at ? Date.parse(r.ended_at) - Date.parse(r.started_at) : null, reason: r.reason,
          tokens: t.tokens, calls: t.calls, apiUsd: t.apiUsd, unpriced: t.unpriced, agents: [...new Set(usage.map((u) => u.agent))],
        };
      }),
      // The latest heartbeat, whatever came after it (D114).
      lastHeartbeat: heartbeat ? { id: heartbeat.id, status: heartbeat.status, area: heartbeat.area, startedAt: heartbeat.started_at, endedAt: heartbeat.ended_at, reason: heartbeat.reason, caps: parseJson(heartbeat.caps) } : null,
      requests: requests.map((r) => ({ id: r.id, runId: r.run_id, area: r.area, kind: r.kind, question: r.question, options: r.options, recommendation: r.recommendation, openedAt: r.opened_at })),
      replies: replyStats(db, since.week, agent),
      // Minor choices the lead agent made on its own, waiting for the user (D116): they hold nothing up.
      assumptions: readAssumptions(dir),
      // What went wrong with the autonomous runs (D121), first in the text output.
      alerts: openAlerts(db),
      // Notes the user sent from Telegram (D133), open until the lead agent records them.
      notes: openNotes(db),
      // What Jérôme blocks for the model here, and what the user unlocked (D194-D196), with the push asked.
      rules: { groups: Object.entries(GROUPS).map(([name, g]) => ({ name, what: g.what, unlocked: Boolean(unlocked(dir)[name]) })), push: pushPending(dir) },
    };
  } finally {
    db.close();
  }
}

// Usage per area over the week (D101): a run's area takes all of its usage; otherwise an agent listed in one area
// only counts for it, and the rest (the lead agent, shared agents) is shared. With a single area, all of it is its.
function areaUsage(dir, db, since, requests) {
  const { areas, implicit } = readAreas(dir);
  const names = new Set(areas.map((a) => a.name));
  const byAgent = agentAreas(areas);
  const rows = db.prepare(`SELECT model, agent, run_area, ${TIER_SQL} long_prompt, ${SUMS} FROM
    (SELECT u.*, r.area run_area FROM usage u LEFT JOIN runs r ON r.id = u.run_id) WHERE at >= ? GROUP BY model, agent, run_area, long_prompt`).all(since);
  const groups = new Map();
  for (const r of rows) {
    const area = areas.length === 1 ? areas[0].name : names.has(r.run_area) ? r.run_area : byAgent.get(r.agent) ?? 'shared';
    (groups.get(area) ?? groups.set(area, []).get(area)).push(r);
  }
  const last = new Map(db.prepare("SELECT area, max(started_at) at FROM runs WHERE kind = 'heartbeat' AND area IS NOT NULL GROUP BY area").all().map((r) => [r.area, r.at]));
  return {
    implicit,
    areas: areas.map((a) => {
      // Only a milestone request holds up its area (D117).
      const request = requests.find((q) => q.area === a.name && q.kind === 'milestone');
      return { ...a, lastHeartbeat: last.get(a.name) ?? null, request: request ? { id: request.id, question: request.question, runId: request.run_id } : null, week: totals(groups.get(a.name) ?? []) };
    }),
    shared: totals(groups.get('shared') ?? []),
  };
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
  // The heartbeat's triage is a service call recorded under its own name, not an agent of the team.
  const seen = [...models.keys()].filter((name) => name !== 'main' && name !== 'triage' && !names.has(name)).sort()
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
  if (s.alerts?.length) {
    lines.push(`ALERTS  ${s.alerts.map((a) => `A${a.id} ${a.reason} (${lostRuns(a)})`).join(' · ')}`);
    lines.push('        tell the user first; `jerome heartbeat status` gives the detail');
  }
  if (s.notes?.length) lines.push(`NOTES   ${s.notes.map((x) => `N${x.id} "${x.text.length > 80 ? `${x.text.slice(0, 79)}…` : x.text}"`).join(' · ')} (from the user, via Telegram: \`jerome note list\`)`);
  const { today, week } = s.usage;
  lines.push(`usage   today ${n(today.tokens)} (in ${n(today.input)} · out ${n(today.output)} · cache read ${n(today.cacheRead)} · write ${n(today.cacheWrite)}) ${usd(today)} · 7d ${n(week.tokens)} ${usd(week)}`);
  const windows = Object.entries(s.windows);
  const limits = WINDOWS.filter((w) => s.limits[w] !== undefined).map((w) => `${s.limits[w]}%`);
  if (windows.length) {
    const current = windows.map(([, w]) => w).filter((w) => !w.stale);
    const latest = current.sort((a, b) => b.readAt.localeCompare(a.readAt))[0];
    const parts = windows.map(([name, w]) => `${name === 'five_hour' ? '5h' : '7d'} ${w.stale ? `no reading since its reset at ${when(new Date(w.resetsAt * 1000).toISOString(), now)}` : `${w.used}%`}`);
    lines.push(`window  ${parts.join(' · ')}${latest ? ` (${latest.source}, ${when(latest.readAt, now)})` : ''}${limits.length ? ` · global limits ${limits.join(' / ')}` : ''}`);
  } else lines.push('window  no reading yet');
  if (s.projectLimits) lines.push(`limits  ${projectSummary(s.projectLimits)} API`);
  // Heartbeats are paused while a limit is reached (D84); they start again when its window resets.
  const paused = (s.projectLimits && projectOver(s.projectLimits)) || globalLimits(now, { windows: s.windows, limits: s.limits }).over;
  if (paused) lines.push(`paused  heartbeats: ${typeof paused === 'string' ? paused : paused.reason}`);
  // Areas (D102), left out while the project has only the implicit one.
  if (!s.agent && s.areas && !s.areasImplicit) {
    const parts = s.areas.map((a) => `${a.name} ${a.milestone ?? ''}${a.pace === 'paused' ? ' paused' : ''}${a.request ? ` waiting R${a.request.id}` : ''} 7d ${n(a.week.tokens)} ${usd(a.week)}`);
    if (s.shared.tokens) parts.push(`shared 7d ${n(s.shared.tokens)} ${usd(s.shared)}`);
    lines.push(`areas   ${parts.join(' · ')}`);
  }
  if (!s.agent) lines.push(`agents  7d: ${s.agents.length ? s.agents.map((a) => `${a.agent} ${n(a.tokens)}`).join(' · ') : 'none'}`);
  lines.push(`runs    ${s.runs.length ? `last ${s.runs.length}: ${s.runs.map((r) => `${when(r.startedAt, now)} ${r.kind}${r.area && !s.areasImplicit ? ` ${r.area}` : ''} ${r.status}${r.reason && r.status !== 'done' ? ` (${r.reason})` : ''} ${n(r.tokens)}`).join(' · ')}` : 'none'}`);
  if (replies) {
    lines.push(`replies 7d: ${s.replies.length ? s.replies.map((r) => `${r.agent} avg ${r.average}w max ${r.max} (${r.over}/${r.replies} over ${REPLY_LIMIT})`).join(' · ') : 'none recorded'}`);
  }
  lines.push(`open    ${s.requests.length ? s.requests.map((r) => `R${r.id} ${r.question} (${when(r.openedAt, now)})`).join(' · ') : 'no decision requests'}`);
  // The lead agent learns how to close a request where it reads it, at no cost to CLAUDE.md (D74).
  if (s.requests.length) lines.push('        propose them to the user; record each answer with `jerome request answer <id> "<answer>"`, or `jerome request drop <id>`');
  if (s.assumptions.length) {
    lines.push(`assumed ${s.assumptions.map((a) => `${a.id} ${a.text}`).join(' · ')}`);
    lines.push('        put them to the user in one block; record confirmed and corrected ones as D-entries and remove them from open.md');
  }
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

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// Whether a window has reset since it was read: its reading is then out of date.
export function isReset(reading, now = new Date()) {
  return Boolean(reading?.resetsAt) && reading.resetsAt * 1000 <= now.getTime();
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
