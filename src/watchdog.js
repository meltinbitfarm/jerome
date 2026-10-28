// `jerome watchdog install | uninstall | status | run` (D134): one launchd job per machine, apart from the
// heartbeats, every minute. Each pass, at zero tokens, for every project on the machine: closes the runs whose
// process is gone (D136), tells the user about heartbeats that should have started and did not (D135), then, with the
// quota governor on, reads the quota and may start a fill run (D142), and runs the Telegram bridge when it is set up
// (D130).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stores } from './store.js';
import { MARKER } from './template.js';
import { openDb } from './db.js';
import { jobPlist, jobPaths, launchAgentsDir, scheduler } from './schedule.js';
import { cacheDir } from './runstate.js';
import { heartbeatConfig } from './heartbeatconfig.js';
import { sweepLostRuns } from './lostruns.js';
import { missedStarts, missedText } from './missed.js';
import { raiseAlert, pushAlert } from './alerts.js';
import { notify } from './notify.js';
import { announceLost } from './heartbeat.js';
import { bridgeTick, readConfig } from './telegram.js';
import { governorTick } from './governor.js';

export { WATCHDOG_LABEL } from './schedule.js';
import { WATCHDOG_LABEL } from './schedule.js';
export const WATCHDOG_SECONDS = 60;
const logFile = () => cacheDir('logs', 'watchdog.log');
const seenPath = () => cacheDir('watchdog', 'missed.json');

function log(line) {
  try {
    mkdirSync(dirname(logFile()), { recursive: true });
    appendFileSync(logFile(), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // The log is a convenience.
  }
}

// One pass. Lines go to the watchdog's log only when something happened, so a quiet minute writes nothing.
export async function watchdogRun({ env = process.env, now = new Date() } = {}) {
  let seen = {};
  try {
    seen = JSON.parse(readFileSync(seenPath(), 'utf8'));
  } catch {
    // Nothing seen yet.
  }
  const week = now.getTime() - 8 * 86_400_000;
  for (const s of stores()) {
    const dir = s.record?.path;
    if (s.orphan || !dir || !existsSync(join(dir, MARKER))) continue;
    try {
      const { config } = heartbeatConfig(dir);
      const say = (line) => log(`${s.key} ${line}`);
      for (const lost of sweepLostRuns(dir, { now })) {
        if (lost.kind === 'heartbeat') announceLost(dir, env, config, say, lost);
        else say(`run ${lost.id} closed, ${lost.reason}`);
      }
      const db = openDb(dir);
      if (!db) continue;
      try {
        // Each missed start once: an alert counted on the open one, a notification and a push.
        for (const m of missedStarts(dir, db, { now, config })) {
          const key = `${m.label}@${m.at.toISOString()}`;
          if (seen[key]) continue;
          seen[key] = now.toISOString();
          const text = missedText(m);
          const a = raiseAlert(db, { reason: text, key: 'missed start', now });
          say(`alert A${a.id}: ${text}`);
          const unseen = notify(env, dir, `Alert A${a.id}: ${text}`);
          if (unseen) say(`alert notification failed: ${unseen}`);
          const failed = pushAlert(config.alerts.command, { project: basename(dir), dir, message: `Jérôme · A${a.id}: ${text}`, env });
          if (failed) say(`alert push failed: ${failed}`);
        }
      } finally {
        db.close();
      }
    } catch (err) {
      log(`${s.key} watchdog error: ${err.message}`);
    }
  }
  seen = Object.fromEntries(Object.entries(seen).filter(([, at]) => Date.parse(at) > week));
  mkdirSync(dirname(seenPath()), { recursive: true });
  writeFileSync(seenPath(), JSON.stringify(seen));
  // The quota governor (D142), when on: a fill run when the week is behind its pace.
  try {
    await governorTick({ env, now, log });
  } catch (err) {
    log(`governor error: ${err.message}`);
  }
  const bridge = await bridgeTick({ env, now });
  if (bridge.configured && (bridge.received || bridge.sent || bridge.ignored || bridge.errors.length)) {
    log(`telegram: ${bridge.received} received, ${bridge.sent} sent${bridge.ignored ? `, ${bridge.ignored} from other chats ignored` : ''}${bridge.errors.length ? `; errors: ${bridge.errors.join('; ')}` : ''}`);
  }
  return 0;
}

export function watchdogFile() {
  return join(launchAgentsDir(), `${WATCHDOG_LABEL}.plist`);
}

export async function watchdogInstall() {
  if (!scheduler()) return fail('The watchdog is scheduled with launchd, so only on macOS for now.', 1);
  const paths = jobPaths();
  mkdirSync(launchAgentsDir(), { recursive: true });
  mkdirSync(dirname(logFile()), { recursive: true });
  writeFileSync(watchdogFile(), jobPlist(homedir(), { label: WATCHDOG_LABEL, paths: { ...paths, claude: paths.claude ?? paths.node }, every: WATCHDOG_SECONDS, args: ['watchdog', 'run'], log: logFile() }));
  launchctl(['bootout', `gui/${userInfo().uid}/${WATCHDOG_LABEL}`]);
  const loaded = launchctl(['bootstrap', `gui/${userInfo().uid}`, watchdogFile()]);
  if (!loaded.ok) return fail(`launchd could not load the watchdog: ${loaded.message}`, 1);
  console.log(`✓ Watchdog every ${WATCHDOG_SECONDS} s (${WATCHDOG_LABEL}): lost runs, missed heartbeats${readConfig() ? ', Telegram' : ''} · log ${logFile()}`);
  return 0;
}

export async function watchdogUninstall() {
  launchctl(['bootout', `gui/${userInfo().uid}/${WATCHDOG_LABEL}`]);
  const had = existsSync(watchdogFile());
  rmSync(watchdogFile(), { force: true });
  console.log(had ? `✓ Removed ${WATCHDOG_LABEL}.` : 'The watchdog was not installed.');
  return 0;
}

export function watchdogLoaded() {
  return existsSync(watchdogFile()) && launchctl(['print', `gui/${userInfo().uid}/${WATCHDOG_LABEL}`]).ok;
}

export async function watchdogStatus() {
  console.log(`watchdog ${!existsSync(watchdogFile()) ? 'not installed: `jerome watchdog install`' : watchdogLoaded() ? `loaded, every ${WATCHDOG_SECONDS} s` : 'installed but not loaded: `jerome watchdog install`'} · log ${logFile()}`);
  return 0;
}

function launchctl(args) {
  const r = spawnSync('launchctl', args, { encoding: 'utf8' });
  return { ok: r.status === 0, message: (r.stderr || r.stdout || '').trim().split('\n')[0] };
}

function fail(message, code) {
  console.error(message);
  return code;
}
