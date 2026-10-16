// Areas (D95-D104): the project's fronts of work, in `.jerome/areas.md`, one `## <name>` section per area with fixed
// lines the CLI reads at zero tokens. A project without the file has one implicit area, `main`, so projects from
// before areas keep working unchanged.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE } from './paths.js';
import { watchedPages, allowedDomains } from './watch.js';

export const AREA_KEYS = ['Goal', 'Milestone', 'Criteria', 'Folder', 'Agents', 'Pace', 'Priority', 'Trigger'];
export const PACES = { hourly: 3_600_000, daily: 86_400_000, weekly: 7 * 86_400_000 };
const NAME = /^[a-z0-9][a-z0-9-]*$/;
export const IMPLICIT = 'main';

// { areas, problems }: problems are reported by doctor; an area with a problem in a line keeps that line's default.
export function parseAreas(text) {
  const areas = [];
  const problems = [];
  const parts = text.replace(/\r\n/g, '\n').split(/^## +(.+?)[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i].trim();
    if (!NAME.test(name)) problems.push(`area "${name}": names are lowercase letters, digits and dashes, such as marketing`);
    if (areas.some((a) => a.name === name)) problems.push(`area "${name}" appears twice`);
    const area = { name, goal: null, milestone: null, criteria: null, folder: '.', agents: [], pace: 'daily', priority: 1, trigger: 'pace' };
    for (const line of parts[i + 1].split('\n')) {
      const m = line.match(/^- *([A-Za-z]+): *(.*?)\s*$/);
      if (!m) {
        if (line.trim()) problems.push(`area "${name}": the line "${line.trim().slice(0, 40)}" is not "- Key: value"`);
        continue;
      }
      const [, key, value] = m;
      if (!AREA_KEYS.includes(key)) problems.push(`area "${name}": no line is called ${key}; the lines are ${AREA_KEYS.join(', ')}`);
      else if (key === 'Agents') area.agents = value.split(',').map((a) => a.trim()).filter((a) => a && a !== 'none');
      else if (key === 'Pace') {
        if (value in PACES || value === 'paused') area.pace = value;
        else problems.push(`area "${name}": Pace is hourly, daily, weekly or paused, not "${value}"`);
      } else if (key === 'Trigger') {
        // D111: `watch` makes the area due only when one of the pages it follows changed.
        if (value === 'pace' || value === 'watch') area.trigger = value;
        else problems.push(`area "${name}": Trigger is pace or watch, not "${value}"`);
      } else if (key === 'Priority') {
        if (/^[1-9]\d*$/.test(value)) area.priority = Number(value);
        else problems.push(`area "${name}": Priority is a whole number from 1, the highest, not "${value}"`);
      } else area[key.toLowerCase()] = value || null;
    }
    for (const key of ['goal', 'milestone', 'criteria']) if (!area[key]) problems.push(`area "${name}" has no ${key[0].toUpperCase()}${key.slice(1)} line`);
    areas.push(area);
  }
  if (!areas.length) problems.push('no area: each one is a "## <name>" section');
  return { areas, problems };
}

// The project's areas: those of areas.md, or the implicit one, whose criteria are the project's success criteria.
export function readAreas(dir) {
  const path = join(dir, STATE.areas);
  if (existsSync(path)) return { ...parseAreas(readFileSync(path, 'utf8')), implicit: false };
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  return {
    areas: [{ name: IMPLICIT, goal: section(read(STATE.project), 'Goal') || null, milestone: null, criteria: section(read(STATE.scope), 'Success') || null, folder: '.', agents: [], pace: null, priority: 1 }],
    problems: [],
    implicit: true,
  };
}

export function section(text, heading) {
  const m = text.match(new RegExp(`^## ${heading}[ \\t]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  return m ? m[1].trim() : '';
}

// An areas.md section, as the brief import writes it.
export function formatArea(a) {
  const lines = [`## ${a.name}`, `- Goal: ${a.goal ?? ''}`, `- Milestone: ${a.milestone ?? ''}`, `- Criteria: ${a.criteria ?? ''}`, `- Folder: ${a.folder ?? '.'}`,
    `- Agents: ${a.agents?.length ? a.agents.join(', ') : 'none'}`, `- Pace: ${a.pace ?? 'daily'}`, `- Priority: ${a.priority ?? 1}`,
    ...(a.trigger === 'watch' ? ['- Trigger: watch'] : [])];
  return `${lines.join('\n')}\n`;
}

// Where an agent's interactive usage goes (D101, D104): the one area that lists it, or null (shared) when several do.
export function agentAreas(areas) {
  const map = new Map();
  for (const a of areas) for (const agent of a.agents) map.set(agent, map.has(agent) ? null : a.name);
  return map;
}

// Whether an area's pace has come round since its last heartbeat. A small slack keeps a daily area due when the
// next day's heartbeat starts a few seconds earlier than the last one did.
export function isDue(area, lastAt, now = new Date()) {
  if (area.pace === 'paused') return false;
  if (!area.pace || !lastAt) return true;
  const period = PACES[area.pace];
  return now.getTime() - Date.parse(lastAt) >= period - Math.min(period * 0.05, 3_600_000);
}

// The areas a heartbeat may work on now (D100), highest priority first, then the one waiting longest, and the others
// with the reason they are left out. `db` gives each area's last heartbeat and open requests.
export function areaPlan(dir, db, now = new Date()) {
  const { areas, implicit } = readAreas(dir);
  const last = new Map(db.prepare("SELECT area, max(started_at) at FROM runs WHERE kind = 'heartbeat' AND area IS NOT NULL GROUP BY area").all().map((r) => [r.area, r.at]));
  const open = new Map(db.prepare("SELECT area, min(id) id FROM requests WHERE status = 'open' AND area IS NOT NULL GROUP BY area").all().map((r) => [r.area, r.id]));
  const due = [];
  const skipped = [];
  for (const a of areas) {
    const lastAt = last.get(a.name) ?? null;
    if (a.pace === 'paused') skipped.push({ name: a.name, why: 'paused' });
    else if (open.has(a.name)) skipped.push({ name: a.name, why: `waiting for R${open.get(a.name)}` });
    else if (!isDue(a, lastAt, now)) skipped.push({ name: a.name, why: `${a.pace} pace, last heartbeat ${lastAt.slice(0, 16).replace('T', ' ')}` });
    else due.push({ ...a, lastAt });
  }
  due.sort((x, y) => x.priority - y.priority || (x.lastAt ?? '').localeCompare(y.lastAt ?? ''));
  return { due, skipped, implicit };
}

// What doctor reports about areas.md (D95, D100): its format, agents without a file, missing folders, and a pace
// more frequent than the project's heartbeats, which would never come round as written.
export function areaWarnings(dir, { agents = [], every = null } = {}) {
  const { areas, problems, implicit } = readAreas(dir);
  if (implicit) return [];
  const warnings = problems.map((p) => ({ id: 'areas', message: `.jerome/areas.md: ${p}.` }));
  const known = new Set(agents);
  for (const a of areas) {
    const missing = a.agents.filter((x) => !known.has(x));
    if (missing.length) warnings.push({ id: 'areas', message: `.jerome/areas.md: area "${a.name}" lists ${missing.join(', ')}, with no file in .claude/agents/.` });
    if (a.folder && !existsSync(join(dir, a.folder))) warnings.push({ id: 'areas', message: `.jerome/areas.md: the folder of area "${a.name}", ${a.folder}, does not exist yet.` });
    if (a.trigger === 'watch') {
      const pages = watchedPages(dir, a.name);
      const domains = allowedDomains(dir);
      if (!pages.length) warnings.push({ id: 'areas', message: `.jerome/areas.md: area "${a.name}" has Trigger: watch, but its section in scope.md has no "- Watch:" line: it will never be due.` });
      const outside = pages.filter((u) => { try { return !domains.has(new URL(u).hostname.toLowerCase()); } catch { return true; } });
      if (outside.length) warnings.push({ id: 'areas', message: `scope.md: area "${a.name}" watches ${outside.join(', ')}, outside the domains its WebFetch rules allow: skipped.` });
    }
    if (every && PACES[a.pace] < PACES[every]) warnings.push({ id: 'areas', message: `.jerome/areas.md: area "${a.name}" has a ${a.pace} pace, but heartbeats run ${every}: it gets at most one per heartbeat.` });
  }
  return warnings;
}
