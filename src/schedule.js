// `jerome schedule`: heartbeats run only when the user schedules them for a project (D71), through a launchd job
// (D72). The job holds the absolute paths of node, jerome and claude detected now, and a PATH built from them:
// launchd loads no shell profile, so version managers such as nvm would not be found.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, accessSync, constants } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { MARKER, readMarker, updateMarker } from './template.js';

export const EVERY = ['hourly', 'daily', 'weekly'];
export const DEFAULT_CAPS = { maxTokens: 500_000, maxTurns: 40 };
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

export async function schedule(dirArg, { every, at, day, maxTokens, maxTurns, off = false, list = false } = {}) {
  if (list) return listJobs();
  if (process.platform !== 'darwin') {
    console.error('Heartbeats are scheduled with launchd, so only on macOS for now.');
    return 1;
  }
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, MARKER))) {
    console.error(`${dir} is not a Jérôme project (the ${MARKER} marker is missing).`);
    return 1;
  }
  const label = jobLabel(dir);
  const plist = join(launchAgentsDir(), `${label}.plist`);
  if (off) {
    launchctl(['bootout', `gui/${userInfo().uid}/${label}`]);
    rmSync(plist, { force: true });
    updateMarker(dir, (m) => { delete m.heartbeat; });
    console.log(`✓ Heartbeat removed for ${dir}`);
    return 0;
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

  const paths = { node: process.execPath, jerome: realpathSync(BIN), claude: which('claude') };
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
  updateMarker(dir, (m) => { m.heartbeat = heartbeat; });
  console.log(`✓ Heartbeat scheduled ${describe(heartbeat)}, at most ${caps.maxTokens.toLocaleString('en')} tokens and ${caps.maxTurns} turns per run`);
  console.log(`  job ${label}, log ${logPath(label)}`);
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

export function plistFor(dir, h) {
  const path = [...new Set([dirname(h.paths.node), dirname(h.paths.claude), '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(':');
  const interval = { Minute: h.minute };
  if (h.every !== 'hourly') interval.Hour = h.hour;
  if (h.every === 'weekly') interval.Weekday = DAYS[h.day];
  const entries = (o) => Object.entries(o).map(([k, v]) => `      <key>${k}</key><integer>${v}</integer>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(h.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(h.paths.node)}</string>
    <string>${xml(h.paths.jerome)}</string>
    <string>heartbeat</string>
    <string>${xml(dir)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(path)}</string>
    <key>HOME</key><string>${xml(homedir())}</string>
  </dict>
  <key>WorkingDirectory</key><string>${xml(dir)}</string>
  <key>StartCalendarInterval</key>
  <dict>
${entries(interval)}
  </dict>
  <key>StandardOutPath</key><string>${xml(logPath(h.label))}</string>
  <key>StandardErrorPath</key><string>${xml(logPath(h.label))}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
}

// What doctor checks for a project with a heartbeat (D72): the job file, the job loaded in launchd, and the paths
// it runs still there, e.g. after switching Node version with nvm. Returns the problems found.
export function heartbeatProblems(dir) {
  let h;
  try {
    h = readMarker(dir).heartbeat;
  } catch {
    return [];
  }
  if (!h) return [];
  const label = jobLabel(dir);
  const plist = join(launchAgentsDir(), `${label}.plist`);
  if (!existsSync(plist)) return [`the job file ${plist} is missing on this machine`];
  const problems = [];
  if (!launchctl(['print', `gui/${userInfo().uid}/${label}`]).ok) problems.push(`the job ${label} is not loaded in launchd`);
  const text = readFileSync(plist, 'utf8');
  const args = [...text.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
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
  return args.length ? problems : [`the job file ${plist} cannot be read`];
}

export function rescheduleCommand(dir, h) {
  const at = h.every === 'hourly' ? `:${String(h.minute).padStart(2, '0')}` : `${String(h.hour).padStart(2, '0')}:${String(h.minute).padStart(2, '0')}`;
  return `jerome schedule ${dir} ${h.every} --at ${at}${h.day ? ` --day ${h.day}` : ''} --max-tokens ${h.maxTokens} --max-turns ${h.maxTurns}`;
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
    try {
      h = readMarker(dir).heartbeat;
    } catch {
      // A project moved or deleted: the job is listed anyway.
    }
    console.log(h ? `${dir} · ${describe(h)} · ${h.maxTokens.toLocaleString('en')} tokens, ${h.maxTurns} turns` : `${dir} · ${file} (project not found)`);
  }
  return 0;
}
