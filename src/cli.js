import { parseArgs } from 'node:util';
import { newProject, initProject } from './new.js';
import { doctor } from './doctor.js';
import { update } from './update.js';
import { prompt } from './prompt.js';
import { docs } from './docs.js';
import { state } from './state.js';
import { hook, HOOK_EVENTS } from './hooks.js';
import { statusline } from './statusline.js';
import { view } from './view.js';
import { schedule, EVERY } from './schedule.js';
import { heartbeat } from './heartbeat.js';
import { install, uninstall, status as heartbeatStatus, override, marathon } from './heartbeatcmd.js';
import { request } from './request.js';
import { digest } from './digest.js';
import { deps } from './deps.js';
import { limits } from './limitscmd.js';
import { forget } from './forget.js';
import { projects } from './projects.js';
import { note } from './notes.js';
import { setup as telegramSetup, off as telegramOff, telegramStatus, telegramTest } from './telegram.js';
import { watchdogInstall, watchdogUninstall, watchdogStatus, watchdogRun } from './watchdog.js';
import { governor, governorStatus, quota } from './governor.js';
import { serve as directorServe, init as directorInit, status as directorStatus, machines as directorMachines, approve as directorApprove, revoke as directorRevoke, dashboard as directorDashboard } from './director.js';
import { connect, connectStatus, disconnect } from './directorlink.js';

const USAGE = `Usage:
  jerome new <name>       create a project from the template in the folder <name>
    --from-file <path>    import a brief from a file, or from standard input with -
  jerome init [dir]       bring Jérôme into an existing project, overwriting nothing (default: current folder)
    --from-file <path>    import a brief from a file, or from standard input with -
  jerome prompt           print the briefing instructions to paste into any chat
  jerome doctor [dir]     check the setup and restore the lean profile (default: current folder)
    --check               only check and report: write nothing (what external tools should use)
    --json                print a machine-readable report (schema jerome.doctor/v1)
    --yes                 relink the database of a project that moved, when it is the only candidate
    --relink <key>        relink that database, chosen among the candidates
    --new-db              start an empty database instead of relinking one
  jerome forget <key>     remove the database of a project that is gone, after a backup (doctor lists them)
    --yes                 without asking
  jerome update [dir]     bring the project's template files up to the installed version
    --check               only show what would change: write nothing
    --yes                 apply without asking; files changed in the project are left as they are
  jerome docs [dir]       bring the entries of .jerome/docs-queue.md into the documentation, with the documentarist
  jerome state [dir]      show usage, runs and open decision requests, compactly (what the lead agent reads)
    --runs <n>            how many recent runs to list (default 3)
    --agent <name>        only one agent's usage
    --json                print a machine-readable report (schema jerome.state/v1)
    --replies             subagents' reply lengths over the last 7 days, per agent
  jerome view [dir]       open the read-only viewer in the browser (local server, stopped with Ctrl+C)
    --port <n>            port to listen on (default: any free port)
    --no-open             print the address without opening the browser
  jerome projects         every project of this machine, from any folder: what needs you first
    --json                print a machine-readable report (schema jerome.projects/v1)
    --view                the same as a page in the browser, each project opening its viewer (--port, --no-open)
  jerome schedule [dir] hourly|daily|weekly
                          run the lead agent on a schedule (macOS, launchd)
    --at <time>           09:00 for daily and weekly (default), :15 for hourly (default :00)
    --day <day>           mon … sun, for weekly (default mon)
    --max-tokens <n>      token cap per run (default 500000)
    --max-turns <n>       turn cap per run (default 40)
    --model <model>       the lead agent's model in heartbeats: opus (default), sonnet, haiku, a model id, or default
    --off                 remove the project's schedule
    --list                list the scheduled projects
  jerome heartbeat [dir]  one scheduled run, as launchd starts it
    --max-tokens <n>, --max-turns <n>
                          caps for this run only, in place of the project's
  jerome heartbeat install [dir] | uninstall [dir]
                          load or remove the project's jobs, one per slot of .jerome/project.json (macOS, launchd)
  jerome heartbeat status [dir]
                          jobs, the run going on, open alerts and the latest runs (--runs <n>, default 8)
  jerome heartbeat run <slot> [dir]
                          one run of that slot, as its job starts it (--max-tokens, --max-turns)
  jerome heartbeat fill [dir]
                          one fill run, as the quota governor starts it when the week is behind its pace
  jerome heartbeat marathon --until <HH:MM> [dir]
                          runs back to back until that time today (24:00 for midnight)
  jerome heartbeat override --today [dir]
                          lift the usage limits on this project's heartbeats until midnight
  jerome request open --question <q> [--options <o>] [--recommendation <r>] [--area <name>] [--milestone]
  jerome request answer <id> <answer> | drop <id>
                          open or close a decision request
  jerome note list [dir] | done <id> [dir]
                          the notes the user sent the project from Telegram, and closing one once recorded
  jerome telegram setup | status | test | off
                          the Telegram bridge of this machine: what waits for you, answers, notes, /status
  jerome watchdog install | uninstall | status | run
                          the job of this machine, every minute: lost runs, missed heartbeats, the Telegram bridge
  jerome governor on | off | status | add [dir] | remove [dir]
                          the quota governor of this machine: fill runs while the subscription's week is behind its pace
    --target <n>          the 7-day window's target at its reset, in % (default 90)
    --reserve <n>         % of the week kept for your own use, released over its last 24 hours (default 20)
    --five-hour-cap <n>   no run starts with the 5-hour window at or over this % (default 90)
  jerome quota [--json]   the subscription's windows as Claude Code's usage endpoint gives them, and the pace
  jerome connect <address> [--name <name>] | connect status | disconnect
                          connect this Mac to Jérôme Director, the coordinator of your Macs, over your VPN
  jerome director init --listen <address> | serve | status | machines | approve <code> | revoke <mac> | dashboard [--new-token]
                          Jérôme Director, on the server: it listens only on a VPN or private address
  jerome digest [dir]     what happened recently, at no token cost
    --since <n>d          the period (default 7d)
  jerome limits [dir]     show the usage limits, global and of the project, with the current usage
    --five-hour <n|off>   global limit on the 5-hour window, in % (account.json)
    --seven-day <n|off>   global limit on the 7-day window, in %
    --daily <usd|off|default>   project limit per calendar day, in API-equivalent dollars (.jerome/project.json; default 5)
    --weekly <usd|off|default>  project limit per calendar week, from Monday (default 20)
  jerome deps             what Jérôme depends on in Claude Code
    --json                machine-readable (schema jerome.deps/v1), for tools that watch Claude Code releases
  jerome hook <event>     run by Claude Code's hooks: ${HOOK_EVENTS.join(', ')}
  jerome statusline       run by Claude Code's status line`;

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  json: { type: 'boolean' },
  check: { type: 'boolean' },
  yes: { type: 'boolean' },
  'from-file': { type: 'string' },
  runs: { type: 'string' },
  agent: { type: 'string' },
  replies: { type: 'boolean' },
  port: { type: 'string' },
  at: { type: 'string' },
  day: { type: 'string' },
  'max-tokens': { type: 'string' },
  'max-turns': { type: 'string' },
  model: { type: 'string' },
  off: { type: 'boolean' },
  list: { type: 'boolean' },
  question: { type: 'string' },
  options: { type: 'string' },
  recommendation: { type: 'string' },
  area: { type: 'string' },
  milestone: { type: 'boolean' },
  since: { type: 'string' },
  'five-hour': { type: 'string' },
  'seven-day': { type: 'string' },
  daily: { type: 'string' },
  weekly: { type: 'string' },
  'no-open': { type: 'boolean' },
  relink: { type: 'string' },
  'new-db': { type: 'boolean' },
  view: { type: 'boolean' },
  until: { type: 'string' },
  today: { type: 'boolean' },
  target: { type: 'string' },
  reserve: { type: 'string' },
  'five-hour-cap': { type: 'string' },
  'new-token': { type: 'boolean' },
  listen: { type: 'string' },
  name: { type: 'string' },
};

// The options each command accepts; any other option is a usage error.
const ALLOWED = { new: ['from-file'], init: ['from-file'], prompt: [], doctor: ['json', 'check', 'yes', 'relink', 'new-db'], forget: ['yes'], update: ['check', 'yes'], docs: [], state: ['json', 'runs', 'agent', 'replies'], hook: [], statusline: [], view: ['port', 'no-open'], projects: ['json', 'view', 'port', 'no-open'],
  schedule: ['at', 'day', 'max-tokens', 'max-turns', 'model', 'off', 'list'], heartbeat: ['max-tokens', 'max-turns', 'until', 'today', 'runs'], request: ['question', 'options', 'recommendation', 'area', 'milestone'], digest: ['since'], deps: ['json'], limits: ['five-hour', 'seven-day', 'daily', 'weekly'], note: [], telegram: [], watchdog: [], governor: ['target', 'reserve', 'five-hour-cap'], quota: ['json'], director: ['listen', 'new-token'], connect: ['name'], disconnect: [] };

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  const [command, ...rest] = parsed.positionals;
  if (parsed.values.help || !command) {
    console.log(USAGE);
    return command || parsed.values.help ? 0 : 2;
  }
  if (!(command in ALLOWED)) return usageError(`Unknown command: ${command}`);
  const extra = Object.keys(parsed.values).filter((o) => !ALLOWED[command].includes(o));
  if (extra.length) return usageError(`${extra.map((o) => `--${o}`).join(', ')} not available for jerome ${command}.`);

  switch (command) {
    case 'new':
      if (rest.length !== 1) return usageError('jerome new takes exactly one name.');
      return newProject(rest[0], { fromFile: parsed.values['from-file'] });
    case 'init':
      if (rest.length > 1) return usageError('jerome init takes at most one folder.');
      return initProject(rest[0] ?? '.', { fromFile: parsed.values['from-file'] });
    case 'prompt':
      if (rest.length) return usageError('jerome prompt takes no arguments.');
      return prompt();
    case 'doctor':
      if (rest.length > 1) return usageError('jerome doctor takes at most one folder.');
      if (parsed.values.relink && parsed.values['new-db']) return usageError('--relink and --new-db exclude each other.');
      return doctor(rest[0] ?? '.', { json: parsed.values.json, check: parsed.values.check, yes: parsed.values.yes, relink: parsed.values.relink ?? null, newDb: parsed.values['new-db'] });
    case 'forget':
      if (rest.length !== 1) return usageError('jerome forget takes exactly one key, as `jerome doctor` lists it.');
      return forget(rest[0], { yes: parsed.values.yes });
    case 'update':
      if (rest.length > 1) return usageError('jerome update takes at most one folder.');
      return update(rest[0] ?? '.', { check: parsed.values.check, yes: parsed.values.yes });
    case 'state': {
      if (rest.length > 1) return usageError('jerome state takes at most one folder.');
      const runs = parsed.values.runs === undefined ? 3 : Number(parsed.values.runs);
      if (!Number.isInteger(runs) || runs < 0) return usageError('--runs takes a whole number.');
      return state(rest[0] ?? '.', { json: parsed.values.json, runs, agent: parsed.values.agent ?? null, replies: parsed.values.replies });
    }
    case 'view': {
      if (rest.length > 1) return usageError('jerome view takes at most one folder.');
      const port = parsed.values.port === undefined ? 0 : Number(parsed.values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) return usageError('--port takes a port number.');
      return view(rest[0] ?? '.', { port, open: !parsed.values['no-open'] });
    }
    case 'projects': {
      if (rest.length) return usageError('jerome projects takes no folder: it shows every project of this machine.');
      if (parsed.values.json && parsed.values.view) return usageError('--json and --view are two ways to show the projects: pick one.');
      if (!parsed.values.view && (parsed.values.port !== undefined || parsed.values['no-open'])) return usageError('--port and --no-open go with --view.');
      const port = parsed.values.port === undefined ? 0 : Number(parsed.values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) return usageError('--port takes a port number.');
      return projects({ json: parsed.values.json, view: parsed.values.view, port, open: !parsed.values['no-open'] });
    }
    case 'schedule': {
      const v = parsed.values;
      if (v.list) return schedule('.', { list: true });
      const every = rest.find((r) => EVERY.includes(r));
      const dirs = rest.filter((r) => r !== every);
      if (dirs.length > 1) return usageError('jerome schedule takes at most one folder.');
      if (!v.off && !every) return usageError(`jerome schedule needs how often: ${EVERY.join(', ')}.`);
      return schedule(dirs[0] ?? '.', { every, at: v.at, day: v.day, maxTokens: v['max-tokens'], maxTurns: v['max-turns'], model: v.model, off: v.off });
    }
    case 'heartbeat': {
      const [sub, ...args] = rest;
      const v = parsed.values;
      // Subcommands (D118); any other word is the project's folder, as launchd's jobs from before give it. A folder
      // named like a subcommand is given as ./status.
      const only = (...allowed) => Object.keys(v).filter((o) => !allowed.includes(o));
      if (['install', 'uninstall', 'status', 'marathon', 'override'].includes(sub)) {
        if (args.length > 1) return usageError(`jerome heartbeat ${sub} takes at most one folder.`);
        const allowed = { install: [], uninstall: [], status: ['runs'], marathon: ['until'], override: ['today'] }[sub];
        if (only(...allowed).length) return usageError(`${only(...allowed).map((o) => `--${o}`).join(', ')} not available for jerome heartbeat ${sub}.`);
        const dir = args[0] ?? '.';
        if (sub === 'install') return install(dir);
        if (sub === 'uninstall') return uninstall(dir);
        if (sub === 'override') return override(dir, { today: v.today === true });
        if (sub === 'marathon') {
          if (!v.until) return usageError('jerome heartbeat marathon needs --until, such as --until 23:30 or --until 24:00.');
          return marathon(dir, { until: v.until });
        }
        const runs = v.runs === undefined ? 8 : Number(v.runs);
        if (!Number.isInteger(runs) || runs < 1) return usageError('--runs takes a positive whole number.');
        return heartbeatStatus(dir, { runs });
      }
      if (only('max-tokens', 'max-turns').length) return usageError(`${only('max-tokens', 'max-turns').map((o) => `--${o}`).join(', ')} not available for jerome heartbeat${sub === 'run' ? ' run' : ''}.`);
      const slot = sub === 'run' ? args[0] : null;
      if (sub === 'run' && !slot) return usageError('jerome heartbeat run takes the name of a slot.');
      const folders = sub === 'run' ? args.slice(1) : sub === 'fill' ? args : rest;
      if (folders.length > 1) return usageError('jerome heartbeat takes at most one folder.');
      const cap = (name) => {
        const raw = parsed.values[name];
        if (raw === undefined) return null;
        const value = Number(raw);
        return Number.isInteger(value) && value > 0 ? value : NaN;
      };
      const maxTokens = cap('max-tokens');
      const maxTurns = cap('max-turns');
      if (Number.isNaN(maxTokens) || Number.isNaN(maxTurns)) return usageError('--max-tokens and --max-turns take positive whole numbers.');
      return heartbeat(folders[0] ?? '.', { maxTokens, maxTurns, slot, fill: sub === 'fill' });
    }
    case 'request': {
      const [action, ...args] = rest;
      if (!['open', 'answer', 'drop'].includes(action)) return usageError('jerome request takes open, answer or drop.');
      return request(action, args, { question: parsed.values.question, options: parsed.values.options, recommendation: parsed.values.recommendation, area: parsed.values.area ?? null, milestone: parsed.values.milestone === true });
    }
    case 'note': {
      const [action, ...args] = rest;
      if (action === 'list' && args.length <= 1) return note('list', [], { dir: args[0] ?? '.' });
      if (action === 'done' && args.length >= 1 && args.length <= 2) return note('done', [args[0]], { dir: args[1] ?? '.' });
      return usageError('jerome note takes list [dir] or done <id> [dir].');
    }
    case 'telegram': {
      const action = rest[0];
      if (rest.length !== 1) return usageError('jerome telegram takes setup, status, test or off.');
      if (action === 'setup') {
        const code = await telegramSetup();
        return code === 0 ? watchdogInstall() : code;
      }
      if (action === 'status') return telegramStatus();
      if (action === 'test') return telegramTest();
      if (action === 'off') return telegramOff();
      return usageError('jerome telegram takes setup, status, test or off.');
    }
    case 'watchdog': {
      const action = rest[0];
      if (rest.length !== 1) return usageError('jerome watchdog takes install, uninstall, status or run.');
      if (action === 'install') return watchdogInstall();
      if (action === 'uninstall') return watchdogUninstall();
      if (action === 'status') return watchdogStatus();
      if (action === 'run') return watchdogRun();
      return usageError('jerome watchdog takes install, uninstall, status or run.');
    }
    case 'governor': {
      const [action, ...args] = rest;
      const v = parsed.values;
      const usage = 'jerome governor takes on, off, status, add [dir] or remove [dir].';
      if (!['on', 'off', 'status', 'add', 'remove'].includes(action) || args.length > (['add', 'remove'].includes(action) ? 1 : 0)) return usageError(usage);
      if (action !== 'on' && Object.keys(v).length) return usageError('--target, --reserve and --five-hour-cap go with jerome governor on.');
      if (action === 'status') return governorStatus();
      return governor(action, args[0], { target: v.target, reserve: v.reserve, fiveHourCap: v['five-hour-cap'] });
    }
    case 'director': {
      const [action, ...args] = rest;
      const usage = 'jerome director takes init, serve, status, machines, approve <code>, revoke <mac> or dashboard.';
      if (parsed.values.listen !== undefined && !['init', 'serve'].includes(action)) return usageError('--listen goes with jerome director init or serve.');
      if (parsed.values['new-token'] !== undefined && action !== 'dashboard') return usageError('--new-token goes with jerome director dashboard.');
      if (action === 'dashboard' && !args.length) return directorDashboard({ newToken: parsed.values['new-token'] === true });
      if (action === 'init' && !args.length) return directorInit({ listen: parsed.values.listen ?? null });
      if (action === 'serve' && !args.length) return directorServe({ listen: parsed.values.listen ?? null });
      if (action === 'status' && !args.length) return directorStatus();
      if (action === 'machines' && !args.length) return directorMachines();
      if (action === 'approve' && args.length === 1) return directorApprove(args[0]);
      if (action === 'revoke' && args.length === 1) return directorRevoke(args[0]);
      return usageError(usage);
    }
    case 'connect': {
      if (rest.length !== 1) return usageError('jerome connect takes the Director\'s address, such as http://100.101.102.103:7788, or status.');
      if (rest[0] === 'status') return connectStatus();
      return connect(rest[0], parsed.values.name !== undefined ? { name: parsed.values.name } : {});
    }
    case 'disconnect':
      if (rest.length) return usageError('jerome disconnect takes nothing.');
      return disconnect();
    case 'quota':
      if (rest.length) return usageError('jerome quota takes no folder: the quota is the account\'s.');
      return quota({ json: parsed.values.json === true });
    case 'digest':
      if (rest.length > 1) return usageError('jerome digest takes at most one folder.');
      return digest(rest[0] ?? '.', { since: parsed.values.since ?? '7d' });
    case 'limits':
      if (rest.length > 1) return usageError('jerome limits takes at most one folder.');
      return limits(rest[0] ?? '.', parsed.values);
    case 'deps':
      if (rest.length) return usageError('jerome deps takes no arguments.');
      return deps({ json: parsed.values.json });
    case 'hook':
      // Hooks never fail a session: even a wrong event name exits with 0.
      if (rest.length !== 1 || !HOOK_EVENTS.includes(rest[0])) return 0;
      return hook(rest[0]);
    case 'statusline':
      return statusline();
    case 'docs':
      if (rest.length > 1) return usageError('jerome docs takes at most one folder.');
      return docs(rest[0] ?? '.');
  }
}

function usageError(message) {
  console.error(`${message}\n\n${USAGE}`);
  return 2;
}
