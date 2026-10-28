// `jerome projects`: every project of this machine at a glance (D114), from any folder and at zero tokens. It reads
// only the database registry (D93) and, for each project, the same readState as `jerome state`, read-only and
// without migrations: no agents, no new state. The projects that need the user come first, with their reasons;
// databases whose folder no longer holds a project are listed with doctor's hints, never hidden.
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { stores, describeStore, storeSummary } from './store.js';
import { readState, n, dollars } from './state.js';
import { readAccount } from './account.js';
import { globalLimits } from './budget.js';
import { readMarker } from './template.js';
import { describe, launchd } from './schedule.js';
import { heartbeatConfig, describeSlot } from './heartbeatconfig.js';
import { needsYou, oneRunCap } from './heartbeat.js';
import { lostRuns } from './alerts.js';

export const PROJECTS_SCHEMA = 'jerome.projects/v1';
const INTERVAL_MS = { hourly: 3_600_000, daily: 86_400_000, weekly: 7 * 86_400_000 };
const NEAR_LEVELS = new Set(['warn', 'high', 'over']);
export const ORPHAN_HINT = 'If the project moved, run `jerome doctor` in its new folder to relink it; if it is gone, `jerome forget <key>` removes the database after a backup.';

export function readProjects({ now = new Date(), account = safeAccount() } = {}) {
  const projects = [];
  const orphans = [];
  for (const s of stores()) {
    if (s.orphan) {
      orphans.push({ key: s.key, was: s.record?.path ?? null, summary: storeSummary(s), text: describeStore(s) });
      continue;
    }
    projects.push(projectRow(s, now, account));
  }
  const attention = projects.filter((p) => p.attention.length);
  const rest = projects.filter((p) => !p.attention.length);
  const byActivity = (a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '') || a.name.localeCompare(b.name);
  return {
    schema: PROJECTS_SCHEMA,
    at: now.toISOString(),
    // The subscription windows are the account's: once for all projects.
    windows: globalLimits(now, account).windows,
    projects: [...attention.sort(byActivity), ...rest.sort(byActivity)],
    orphans,
  };
}

function safeAccount() {
  try {
    return readAccount();
  } catch {
    return { windows: {}, limits: {} };
  }
}

function projectRow(s, now, account) {
  const dir = s.record.path;
  const row = { key: s.key, name: basename(dir), path: dir, error: null, areas: [], areasImplicit: true, requests: [], alerts: [], assumptions: 0, lastHeartbeat: null, lastActivity: null, week: null, projectLimits: null, schedule: null, attention: [] };
  try {
    const h = readMarker(dir).heartbeat;
    const { slots } = heartbeatConfig(dir).config;
    // With slots (D118), the shortest interval they may leave: hourly, daily, or weekly when some run on given days only.
    if (slots.length) {
      const every = slots.some((x) => x.times.some((t) => t.hour === undefined)) ? 'hourly' : slots.some((x) => x.days) ? 'weekly' : 'daily';
      row.schedule = { every, text: `slots ${slots.map((x) => `${x.name} ${describeSlot(x)}`).join(' · ')}` };
    } else if (h?.every) row.schedule = { every: h.every, text: describe(h) };
  } catch {
    // A marker that cannot be read leaves the project unscheduled here; doctor reports it.
  }
  let st;
  try {
    st = readState(dir, { runs: 1, readOnly: true, now, account });
  } catch (err) {
    row.error = err.message;
    row.attention.push(err.message);
    return row;
  }
  if (!st) {
    row.error = 'the project database is missing: run `jerome doctor`';
    row.attention.push(row.error);
    return row;
  }
  row.areas = st.areas.map((a) => ({ name: a.name, milestone: a.milestone ?? null, pace: a.pace ?? null }));
  row.areasImplicit = st.areasImplicit;
  row.alerts = st.alerts.map((a) => ({ id: a.id, reason: a.reason, count: a.count, openedAt: a.openedAt, lastAt: a.lastAt }));
  row.requests = st.requests.map((r) => ({ id: r.id, question: r.question, area: r.area, openedAt: r.openedAt }));
  // Assumptions hold nothing up (D116): counted, never a reason for attention.
  row.assumptions = st.assumptions.length;
  row.lastHeartbeat = st.lastHeartbeat;
  row.lastActivity = st.runs[0]?.startedAt ?? null;
  row.week = { tokens: st.usage.week.tokens, apiUsd: st.usage.week.apiUsd, unpriced: st.usage.week.unpriced };
  row.projectLimits = st.projectLimits;
  row.attention = attention(row, dir, now);
  return row;
}

// Why a project needs the user, in the order they are listed.
function attention(row, dir, now) {
  const reasons = [];
  if (row.alerts.length) reasons.push(`${row.alerts.length} heartbeat ${row.alerts.length === 1 ? 'alert' : 'alerts'}: ${row.alerts.map((a) => `A${a.id} ${a.reason} (${lostRuns(a)})`).join(' · ')}`);
  if (row.requests.length) reasons.push(`${row.requests.length} open decision ${row.requests.length === 1 ? 'request' : 'requests'}: ${row.requests.map((r) => `R${r.id}`).join(', ')}`);
  const h = row.lastHeartbeat;
  // A limit is not a reason: it shows with the limits, and reaching it pauses heartbeats by itself.
  if (h && (h.status === 'failed' || (h.status === 'stopped' && !(h.caps?.once ?? oneRunCap(h.reason))) || (h.status === 'blocked' && needsYou(h.reason)))) reasons.push(`heartbeat ${h.status}: ${h.reason}`);
  const late = lateHeartbeat(row, dir, now);
  if (late) reasons.push(late);
  return reasons;
}

// A scheduled project whose latest heartbeat is older than twice its interval: launchd is not starting it. With no
// heartbeat at all, the job file's age stands for the time it was scheduled.
function lateHeartbeat(row, dir, now) {
  if (!row.schedule) return null;
  const interval = INTERVAL_MS[row.schedule.every];
  const last = row.lastHeartbeat?.startedAt ? Date.parse(row.lastHeartbeat.startedAt) : null;
  let since = last;
  if (since === null) {
    const plists = launchd.installed(dir).map((l) => launchd.file(l));
    if (!plists.length) return null;
    since = Math.min(...plists.map((p) => statSync(p).mtimeMs));
  }
  const age = now.getTime() - since;
  if (age <= 2 * interval) return null;
  return last === null
    ? `no heartbeat in the ${span(age)} since it was scheduled (${row.schedule.text})`
    : `no heartbeat for ${span(age)} (scheduled ${row.schedule.text})`;
}

// 90 minutes → "1 hour", 30 hours → "30 hours", 3.2 days → "3 days".
export function span(ms) {
  const plural = (v, unit) => `${v} ${unit}${v === 1 ? '' : 's'}`;
  if (ms < 3_600_000) return plural(Math.max(1, Math.floor(ms / 60_000)), 'minute');
  if (ms < 48 * 3_600_000) return plural(Math.floor(ms / 3_600_000), 'hour');
  return plural(Math.floor(ms / 86_400_000), 'day');
}

// "2 h ago", "3 days ago".
function ago(iso, now) {
  return `${span(Math.max(0, now.getTime() - Date.parse(iso)))} ago`;
}

const short = (text) => (text.length > 20 ? `${text.slice(0, 19)}…` : text);
const home = homedir();
const tilde = (path) => (path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);

export function formatProjects(p) {
  const now = new Date(p.at);
  const count = p.projects.length;
  const needing = p.projects.filter((x) => x.attention.length).length;
  const lines = [`jerome projects · ${count} ${count === 1 ? 'project' : 'projects'}${needing ? `, ${needing} ${needing === 1 ? 'needs' : 'need'} you` : ''}`];
  const windows = Object.entries(p.windows);
  if (windows.length) {
    lines.push(`account ${windows.map(([name, w]) => `${name === 'five_hour' ? '5h' : '7d'} ${w.stale ? 'no reading since its reset' : `${w.used}%${w.limit !== null ? `/${w.limit}%` : ''}${NEAR_LEVELS.has(w.level) ? ` (${w.level})` : ''}`}`).join(' · ')}`);
  } else lines.push('account no reading of the subscription windows yet');
  if (!count && !p.orphans.length) {
    lines.push('', 'No project on this machine yet: `jerome new <name>` creates one, `jerome init` brings Jérôme into an existing one.');
    return lines.join('\n');
  }
  const attention = p.projects.filter((x) => x.attention.length);
  if (attention.length) {
    lines.push('');
    for (const x of attention) {
      lines.push(`! ${x.name}  ${tilde(x.path)}`);
      for (const r of x.attention) lines.push(`    ${r}`);
    }
  }
  if (count) {
    const rows = p.projects.map((x) => [
      `${x.attention.length ? '!' : ' '} ${x.name}`,
      x.error ? '—' : x.areasImplicit ? '—' : x.areas.map((a) => `${a.name} ${short(a.milestone ?? '')}`.trim()).join(', '),
      x.error ? '—' : String(x.requests.length),
      x.error ? '—' : String(x.assumptions),
      x.error ? 'unreadable' : x.lastHeartbeat ? `${ago(x.lastHeartbeat.startedAt, now)} ${x.lastHeartbeat.status}` : x.schedule ? 'none yet' : 'not scheduled',
      x.error ? '—' : `${n(x.week.tokens)} ${dollars(x.week.apiUsd)}${x.week.unpriced ? '+?' : ''}`,
      tilde(x.path),
    ]);
    const head = ['  PROJECT', 'AREAS', 'REQ', 'ASSUMED', 'LAST HEARTBEAT', '7 DAYS', 'FOLDER'];
    const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ');
    lines.push('', line(head), ...rows.map(line));
  }
  if (p.orphans.length) {
    lines.push('', `${p.orphans.length === 1 ? 'A database belongs' : `${p.orphans.length} databases belong`} to a folder that no longer holds a Jérôme project:`);
    for (const o of p.orphans) lines.push(`  ${o.text}, ${o.summary}`);
    lines.push(`  ${ORPHAN_HINT}`);
  }
  return lines.join('\n');
}

export async function projects({ json = false, view = false, port = 0, open = true } = {}) {
  if (view) {
    const { viewProjects } = await import('./view.js');
    return viewProjects({ port, open });
  }
  let report;
  try {
    report = readProjects();
  } catch (err) {
    console.error(`Cannot read the projects: ${err.message}`);
    return 1;
  }
  console.log(json ? JSON.stringify(report, null, 2) : formatProjects(report));
  return 0;
}
