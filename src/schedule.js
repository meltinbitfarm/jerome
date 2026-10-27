// `jerome schedule`: heartbeats run only when the user schedules them for a project (D71), through a launchd job
// (D72). The job holds the absolute paths of node, jerome and claude detected now, and a PATH built from them:
// launchd loads no shell profile, so version managers such as nvm would not be found. Since D118 a project may
// have slots instead, one job each, installed with `jerome heartbeat install`; `jerome schedule` stays as the
// shorthand for one slot. The scheduler is reached through `scheduler()`, so another one can take launchd's place.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, accessSync, constants } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { MARKER, readMarker, updateMarker } from './template.js';
import { notProjectMessage } from './paths.js';
import { areaWarnings } from './areas.js';
import { heartbeatConfig, dayNumber, describeSlot } from './heartbeatconfig.js';

export const EVERY = ['hourly', 'daily', 'weekly'];
export const DEFAULT_CAPS = { maxTokens: 500_000, maxTurns: 40 };
const MODEL = /^(opus|sonnet|haiku|default|claude-[a-z0-9.-]+)$/;
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const LABEL_PREFIX = 'com.jerome.heartbeat.';
const BIN = join(import.meta.dirname, '..', 'bin', 'jerome.js');

export function launchAgentsDir() {
  return join(homedir(), 'Library', 'LaunchAgents');
}

export function jobLabel(dir) {
  const id = createHash('sha256').update(dir).digest('hex').slice(0, 8);
  return `${LABEL_PREFIX}${basename(dir).replace(/[^\w.-]/g, '-')}-${id}`;
}

export function logPath(label) {
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(cache, 'jerome', 'logs', `${label.slice(LABEL_PREFIX.length)}.log`);
}

export async function schedule(dirArg, { every, at, day, maxTokens, maxTurns, model, off = false, list = false } = {}) {
  if (list) return listJobs();
  if (process.platform !== 'darwin') {
    console.error('Heartbeats are scheduled with launchd, so only on macOS for now.');
    return 1;
  }
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, MARKER))) {
    console.error(notProjectMessage(dir));
    return 1;
  }
  const label = jobLabel(dir);
  const plist = join(launchAgentsDir(), `${label}.plist`);
  if (off) {
    for (const l of launchd.installed(dir)) launchd.remove(l);
    // The schedule goes; the settings of D118, if any, stay for `jerome heartbeat install`.
    updateMarker(dir, (m) => {
      for (const key of ['every', 'hour', 'minute', 'day', 'slots']) delete m.heartbeat?.[key];
      if (m.heartbeat && !Object.keys(m.heartbeat).some((k) => !['maxTokens', 'maxTurns', 'model'].includes(k))) delete m.heartbeat;
    });
    console.log(`✓ Heartbeat removed for ${dir}`);
    return 0;
  }
  if (heartbeatConfig(dir).config.slots.length) {
    console.error('This project has slots in .jerome/project.json: change them there and run `jerome heartbeat install`.');
    return 1;
  }

  if (!EVERY.includes(every)) {
    console.error(`Choose how often: ${EVERY.join(', ')}.`);
    return 2;
  }
  const time = parseAt(at, every);
  if (!time) {
    console.error(every === 'hourly' ? '--at takes the minute, such as :15.' : '--at takes a time, such as 09:00.');
    return 2;
  }
  if (every === 'weekly' && day !== undefined && !(day in DAYS)) {
    console.error(`--day takes one of ${Object.keys(DAYS).join(', ')}.`);
    return 2;
  }
  const caps = {
    maxTokens: maxTokens === undefined ? DEFAULT_CAPS.maxTokens : Number(maxTokens),
    maxTurns: maxTurns === undefined ? DEFAULT_CAPS.maxTurns : Number(maxTurns),
  };
  if (!Number.isInteger(caps.maxTokens) || caps.maxTokens <= 0 || !Number.isInteger(caps.maxTurns) || caps.maxTurns <= 0) {
    console.error('--max-tokens and --max-turns take positive whole numbers.');
    return 2;
  }
  // The lead agent's model in heartbeats (D106): an alias or a full id; `default` goes back to Opus.
  if (model !== undefined && !MODEL.test(model)) {
    console.error('--model takes opus, sonnet, haiku, a full model id such as claude-sonnet-5-5, or default.');
    return 2;
  }

  const paths = jobPaths();
  if (!paths.claude) {
    console.error('`claude` was not found on the PATH: install Claude Code first.');
    return 1;
  }
  // `.jerome` is versioned: it gets the schedule and the caps only. The label and the paths of this machine live in
  // the job file, outside the project.
  const heartbeat = { every, ...time, ...(every === 'weekly' ? { day: day ?? 'mon' } : {}), ...caps };
  mkdirSync(launchAgentsDir(), { recursive: true });
  mkdirSync(dirname(logPath(label)), { recursive: true });
  writeFileSync(plist, plistFor(dir, { ...heartbeat, label, paths }));
  launchctl(['bootout', `gui/${userInfo().uid}/${label}`]);
  const loaded = launchctl(['bootstrap', `gui/${userInfo().uid}`, plist]);
  if (!loaded.ok) {
    console.error(`launchctl could not load the job: ${loaded.message}`);
    return 1;
  }
  // Without --model, a new schedule keeps the model the heartbeats had (D106).
  let kept = null;
  updateMarker(dir, (m) => {
    kept = model === undefined ? m.heartbeat?.model ?? null : model === 'default' ? null : model;
    const { model: _m, every: _e, hour: _h, minute: _n, day: _d, ...rest } = m.heartbeat ?? {};
    m.heartbeat = { ...rest, ...heartbeat, ...(kept ? { model: kept } : {}) };
  });
  console.log(`✓ Heartbeat scheduled ${describe(heartbeat)}, on ${kept ?? 'opus'}, at most ${caps.maxTokens.toLocaleString('en')} tokens and ${caps.maxTurns} turns per run`);
  console.log(`  job ${label}, log ${logPath(label)}`);
  // An area paced faster than the heartbeats gets at most one per heartbeat (D100).
  for (const w of areaWarnings(dir, { every }).filter((x) => / pace, but heartbeats run /.test(x.message))) console.log(`! ${w.message}`);
  return 0;
}

// "09:00" for daily and weekly, ":15" (or "15") for hourly.
function parseAt(at, every) {
  if (every === 'hourly') {
    const m = String(at ?? ':00').match(/^:?(\d{1,2})$/);
    return m && Number(m[1]) < 60 ? { minute: Number(m[1]) } : null;
  }
  const m = String(at ?? '09:00').match(/^(\d{1,2}):(\d{2})$/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

export function describe(h) {
  const pad = (x) => String(x).padStart(2, '0');
  if (h.every === 'hourly') return `every hour at :${pad(h.minute)}`;
  if (h.every === 'daily') return `every day at ${pad(h.hour)}:${pad(h.minute)}`;
  return `every ${h.day} at ${pad(h.hour)}:${pad(h.minute)}`;
}

// The executables a job runs, found now (D72): node, Jérôme and claude, and the jerome command the lead agent
// calls, which an npm install puts next to node.
export function jobPaths() {
  return { node: process.execPath, jerome: realpathSync(BIN), claude: which('claude'), jeromeCommand: which('jerome') };
}

function which(command) {
  try {
    return execFileSync('/usr/bin/which', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function launchctl(args) {
  const r = spawnSync('launchctl', args, { encoding: 'utf8' });
  return { ok: r.status === 0, message: (r.stderr || r.stdout || '').trim().split('\n')[0] };
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The job of `jerome schedule`: one interval, running `jerome heartbeat <dir>`.
export function plistFor(dir, h) {
  const interval = { Minute: h.minute };
  if (h.every !== 'hourly') interval.Hour = h.hour;
  if (h.every === 'weekly') interval.Weekday = DAYS[h.day];
  return jobPlist(dir, { label: h.label, paths: h.paths, intervals: [interval], args: ['heartbeat', dir] });
}

// A launchd job: node running Jérôme with args, at each of the intervals, with a PATH that finds node, claude,
// jerome and git, and its output appended to the project's log.
export function jobPlist(dir, { label, paths, intervals, args, log = logPath(jobLabel(dir)) }) {
  const path = [...new Set([dirname(paths.node), dirname(paths.claude), ...(paths.jeromeCommand ? [dirname(paths.jeromeCommand)] : []),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(':');
  const entries = (o) => Object.entries(o).map(([k, v]) => `      <key>${k}</key><integer>${v}</integer>`).join('\n');
  const calendar = intervals.length === 1
    ? `  <dict>\n${entries(intervals[0])}\n  </dict>`
    : `  <array>\n${intervals.map((i) => `    <dict>\n${entries(i).replace(/^ {6}/gm, '      ')}\n    </dict>`).join('\n')}\n  </array>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${[paths.node, paths.jerome, ...args].map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(path)}</string>
    <key>HOME</key><string>${xml(homedir())}</string>
  </dict>
  <key>WorkingDirectory</key><string>${xml(dir)}</string>
  <key>StartCalendarInterval</key>
${calendar}
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
}

// The jobs a project should have (D118): one per slot, each running `jerome heartbeat run <slot> <dir>`, or the one
// of `jerome schedule`; none when it has neither.
export function projectJobs(dir, config = heartbeatConfig(dir).config) {
  if (config.slots.length) {
    return config.slots.map((s) => ({
      label: `${jobLabel(dir)}.${s.name}`, slot: s.name, args: ['heartbeat', 'run', s.name, dir],
      intervals: (s.days ?? [null]).flatMap((d) => s.times.map((t) => ({ ...(t.hour === undefined ? {} : { Hour: t.hour }), Minute: t.minute, ...(d === null ? {} : { Weekday: dayNumber(d) }) }))),
    }));
  }
  const h = config.legacy;
  if (!h) return [];
  const interval = { ...(h.every === 'hourly' ? {} : { Hour: h.hour }), Minute: h.minute, ...(h.every === 'weekly' ? { Weekday: DAYS[h.day ?? 'mon'] } : {}) };
  return [{ label: jobLabel(dir), slot: null, args: ['heartbeat', dir], intervals: [interval] }];
}

// The scheduler layer: what installing a project's jobs needs from the system's scheduler. launchd is the only one
// for now; another (systemd timers, cron) takes its place by giving the same five functions.
export const launchd = {
  name: 'launchd',
  write(dir, job, paths) {
    const plist = join(launchAgentsDir(), `${job.label}.plist`);
    mkdirSync(launchAgentsDir(), { recursive: true });
    mkdirSync(dirname(logPath(jobLabel(dir))), { recursive: true });
    writeFileSync(plist, jobPlist(dir, { ...job, paths }));
    launchctl(['bootout', `gui/${userInfo().uid}/${job.label}`]);
    const loaded = launchctl(['bootstrap', `gui/${userInfo().uid}`, plist]);
    return loaded.ok ? null : loaded.message;
  },
  remove(label) {
    launchctl(['bootout', `gui/${userInfo().uid}/${label}`]);
    rmSync(join(launchAgentsDir(), `${label}.plist`), { force: true });
  },
  loaded(label) {
    return launchctl(['print', `gui/${userInfo().uid}/${label}`]).ok;
  },
  // The labels of the jobs installed for a project, whatever its settings say now.
  installed(dir) {
    const base = jobLabel(dir);
    const folder = launchAgentsDir();
    return existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.plist')).map((f) => f.slice(0, -6)).filter((l) => l === base || l.startsWith(`${base}.`)).sort() : [];
  },
  file(label) {
    return join(launchAgentsDir(), `${label}.plist`);
  },
};

export function scheduler(platform = process.platform) {
  return { darwin: launchd }[platform] ?? null;
}

// What doctor checks for a project with a heartbeat (D72): each job file, the job loaded in launchd, and the paths
// it runs still there, e.g. after switching Node version with nvm. Returns the problems found.
export function heartbeatProblems(dir) {
  let jobs;
  try {
    jobs = projectJobs(dir);
  } catch {
    return [];
  }
  const problems = [];
  for (const job of jobs) {
    const plist = launchd.file(job.label);
    if (!existsSync(plist)) {
      problems.push(`the job file ${plist} is missing on this machine`);
      continue;
    }
    if (!launchd.loaded(job.label)) problems.push(`the job ${job.label} is not loaded in launchd`);
    const text = readFileSync(plist, 'utf8');
    const args = [...text.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
    if (!args.length) {
      problems.push(`the job file ${plist} cannot be read`);
      continue;
    }
    const program = text.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>\s*<string>([^<]*)<\/string>/);
    const path = text.match(/<key>PATH<\/key><string>([^<]*)<\/string>/)?.[1] ?? '';
    const checks = program ? [['node', program[1], constants.X_OK], ['jerome', program[2], constants.R_OK]] : [];
    const claude = path.split(':').map((d) => join(d, 'claude')).find((p) => existsSync(p));
    if (!claude) problems.push('claude is not in any folder of the job\'s PATH');
    for (const [name, file, mode] of checks) {
      try {
        accessSync(file, mode);
      } catch {
        problems.push(`${name} is no longer at ${file}`);
      }
    }
  }
  // Slots removed from the settings leave jobs that would start a run for a slot that no longer exists.
  const expected = new Set(jobs.map((j) => j.label));
  for (const label of launchd.installed(dir)) if (!expected.has(label)) problems.push(`the job ${label} is not in the project's settings`);
  return [...new Set(problems)];
}

export function rescheduleCommand(dir, h) {
  if (heartbeatConfig(dir).config.slots.length || !h?.every) return `jerome heartbeat install ${dir}`;
  const at = h.every === 'hourly' ? `:${String(h.minute).padStart(2, '0')}` : `${String(h.hour).padStart(2, '0')}:${String(h.minute).padStart(2, '0')}`;
  return `jerome schedule ${dir} ${h.every} --at ${at}${h.day ? ` --day ${h.day}` : ''} --max-tokens ${h.maxTokens} --max-turns ${h.maxTurns}${h.model ? ` --model ${h.model}` : ''}`;
}

function listJobs() {
  const folder = launchAgentsDir();
  const jobs = existsSync(folder) ? readdirSync(folder).filter((f) => f.startsWith(LABEL_PREFIX) && f.endsWith('.plist')) : [];
  if (!jobs.length) {
    console.log('No heartbeats scheduled.');
    return 0;
  }
  for (const file of jobs.sort()) {
    const text = readFileSync(join(folder, file), 'utf8');
    const dir = text.match(/<key>WorkingDirectory<\/key><string>([^<]*)<\/string>/)?.[1] ?? '?';
    let h = null;
    let slots = [];
    try {
      h = readMarker(dir).heartbeat;
      slots = heartbeatConfig(dir).config.slots;
    } catch {
      // A project moved or deleted: the job is listed anyway.
    }
    const slot = slots.find((s) => file === `${jobLabel(dir)}.${s.name}.plist`);
    if (slot) console.log(`${dir} · slot ${slot.name} · ${describeSlot(slot)}`);
    else console.log(h?.every ? `${dir} · ${describe(h)} · ${h.maxTokens.toLocaleString('en')} tokens, ${h.maxTurns} turns` : `${dir} · ${file} (${h ? 'not in the project\'s settings' : 'project not found'})`);
  }
  return 0;
}
