// The settings of a project's autonomous runs (D118), under "heartbeat" in `.jerome/project.json`, next to the caps
// and model of D71-D106. Everything has a default, so a project scheduled with `jerome schedule` keeps working: an
// invalid entry is reported (by doctor and by `jerome heartbeat install`) and its default applies.
import { readMarker } from './template.js';

export const DEFAULT_RUNS = { mainBranch: 'main', workBranch: 'agent/*', maxMinutes: 90 };
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SLOT_NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;
// "09:00", or "*:15" for every hour at :15.
const TIME = /^(\*|\d{1,2}):(\d{2})$/;
// A Claude Code permission rule, such as "Bash(npm run e2e)", "Bash(./tools/fetch.sh:*)" or "WebFetch(domain:x.org)".
const RULE = /^[A-Za-z][\w-]*(\(.+\))?$/s;

export function heartbeatConfig(dir) {
  let h;
  try {
    h = readMarker(dir).heartbeat ?? {};
  } catch {
    h = {};
  }
  const problems = [];
  const where = (key) => `.jerome/project.json: heartbeat.${key}`;
  const config = { ...DEFAULT_RUNS, quota: {}, test: null, prompt: null, alerts: { command: null }, allow: [], slots: [], legacy: h.every ? h : null };

  for (const key of ['mainBranch', 'workBranch']) {
    if (h[key] === undefined) continue;
    if (typeof h[key] === 'string' && h[key].trim() && !/\s/.test(h[key])) config[key] = h[key].trim();
    else problems.push(`${where(key)} must be a branch name${key === 'workBranch' ? ' pattern such as agent/*' : ''}; the default (${DEFAULT_RUNS[key]}) applies.`);
  }
  if (config.workBranch === config.mainBranch || !config.workBranch.includes('*')) {
    problems.push(`${where('workBranch')} must hold a * and differ from the main branch; the default (${DEFAULT_RUNS.workBranch}) applies.`);
    config.workBranch = DEFAULT_RUNS.workBranch;
  }
  if (h.maxMinutes !== undefined) {
    if (typeof h.maxMinutes === 'number' && h.maxMinutes > 0) config.maxMinutes = h.maxMinutes;
    else problems.push(`${where('maxMinutes')} must be a positive number of minutes; the default (${DEFAULT_RUNS.maxMinutes}) applies.`);
  }
  // The project's own thresholds on the subscription windows, in % (D124), in place of the global ones for its runs.
  if (h.quota !== undefined) {
    if (typeof h.quota !== 'object' || h.quota === null || Array.isArray(h.quota)) problems.push(`${where('quota')} must be an object such as { "fiveHour": 70, "sevenDay": 80 }.`);
    else {
      for (const [key, value] of Object.entries(h.quota)) {
        if (!['fiveHour', 'sevenDay'].includes(key)) problems.push(`${where('quota')}: no window is called "${key}"; they are fiveHour and sevenDay.`);
        else if (typeof value !== 'number' || value <= 0 || value > 100) problems.push(`${where(`quota.${key}`)} must be a percentage between 1 and 100; the global limit applies.`);
        else config.quota[key] = value;
      }
    }
  }
  for (const key of ['test', 'prompt']) {
    if (h[key] === undefined || h[key] === null) continue;
    if (typeof h[key] === 'string' && h[key].trim()) config[key] = h[key].trim();
    else problems.push(`${where(key)} must be a non-empty string.`);
  }
  // The push channel (D121): a command the runner starts with the alert on standard input. It is versioned, so it
  // must hold no secret: it reads one from the machine (a file, the keychain), never from this file.
  if (h.alerts !== undefined) {
    const command = h.alerts?.command;
    if (command === null || command === undefined) config.alerts.command = null;
    else if (typeof command === 'string' && command.trim()) config.alerts.command = command.trim();
    else problems.push(`${where('alerts.command')} must be a shell command, or null for none.`);
  }
  // Tools the lead agent may use in a run beyond the project's own allow rules (D129), passed as --allowedTools.
  if (h.allow !== undefined) config.allow = readRules(h.allow, problems, where('allow'));
  if (h.slots !== undefined) {
    if (!Array.isArray(h.slots)) problems.push(`${where('slots')} must be a list of { "name", "at": ["09:00"], "days"?, "text"? }.`);
    else {
      for (const [i, s] of h.slots.entries()) {
        const slot = readSlot(s, problems, `${where(`slots[${i}]`)}`);
        if (!slot) continue;
        if (config.slots.some((x) => x.name === slot.name)) problems.push(`${where(`slots[${i}]`)}: the name ${slot.name} is used twice.`);
        else config.slots.push(slot);
      }
    }
  }
  return { config, problems };
}

function readSlot(s, problems, where) {
  if (typeof s !== 'object' || s === null) {
    problems.push(`${where} must be an object.`);
    return null;
  }
  if (typeof s.name !== 'string' || !SLOT_NAME.test(s.name)) {
    problems.push(`${where}.name must be lower-case letters, digits and dashes, such as "morning".`);
    return null;
  }
  const at = Array.isArray(s.at) ? s.at : [s.at];
  const times = [];
  for (const t of at) {
    const m = String(t ?? '').match(TIME);
    if (!m || (m[1] !== '*' && Number(m[1]) > 23) || Number(m[2]) > 59) {
      problems.push(`${where}.at: "${t}" is not a time such as "09:00" or "*:15"; the slot is left out.`);
      return null;
    }
    times.push(m[1] === '*' ? { minute: Number(m[2]) } : { hour: Number(m[1]), minute: Number(m[2]) });
  }
  let days = null;
  if (s.days !== undefined) {
    if (!Array.isArray(s.days) || !s.days.length || s.days.some((d) => !DAYS.includes(d))) {
      problems.push(`${where}.days must list days among ${DAYS.join(', ')}; the slot is left out.`);
      return null;
    }
    days = s.days;
  }
  if (s.text !== undefined && typeof s.text !== 'string') {
    problems.push(`${where}.text must be a string; the slot is left out.`);
    return null;
  }
  return { name: s.name, times, days, text: s.text?.trim() || null, allow: s.allow === undefined ? [] : readRules(s.allow, problems, `${where}.allow`) };
}

function readRules(list, problems, where) {
  if (!Array.isArray(list)) {
    problems.push(`${where} must be a list of permission rules such as "Bash(npm run e2e)".`);
    return [];
  }
  return list.filter((r) => {
    const ok = typeof r === 'string' && RULE.test(r.trim());
    if (!ok) problems.push(`${where}: "${r}" is not a permission rule such as "Bash(npm run e2e)"; it is left out.`);
    return ok;
  }).map((r) => r.trim());
}

// What a run of the lead agent may do beyond the project's allow rules (D129): the test command, which the runner
// tells it to run, and the project's and the slot's own rules.
export function runAllowed(config, slot = null) {
  const test = config.test ? [`Bash(${config.test})`, `Bash(${config.test}:*)`] : [];
  return [...new Set([...test, ...config.allow, ...(slot?.allow ?? [])])];
}

// "09:00, 18:00 mon-fri"-like text for a slot.
export function describeSlot(slot) {
  const pad = (x) => String(x).padStart(2, '0');
  const times = slot.times.map((t) => (t.hour === undefined ? `every hour at :${pad(t.minute)}` : `${pad(t.hour)}:${pad(t.minute)}`)).join(', ');
  return `${times}${slot.days ? ` on ${slot.days.join(', ')}` : ''}`;
}

export function dayNumber(day) {
  return DAYS.indexOf(day);
}

// Whether one of the slots comes round within `minutes` from now, local time: a fill run started now could still hold
// the project's lock then, and the slot's run would find it locked.
export function slotWithin(slots, minutes, now = new Date()) {
  for (let m = 1; m <= minutes; m++) {
    const at = new Date(now.getTime() + m * 60_000);
    const day = DAYS[at.getDay()];
    for (const s of slots) {
      if (s.days && !s.days.includes(day)) continue;
      if (s.times.some((t) => t.minute === at.getMinutes() && (t.hour === undefined || t.hour === at.getHours()))) return true;
    }
  }
  return false;
}
