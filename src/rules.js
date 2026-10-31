// `jerome rules`: what Jérôme blocks for the model in a project, and what the user unlocked there (D194, D195). The
// groups are the deny rules of limits.js, by name; the choice is kept in the project's store (unlocked.js), and
// unlocking asks for the project's name typed at a terminal, which a command run by the model has not.
// - push: its rules stay; Jérôme asks the user on Telegram once the main branch has commits not pushed, and pushes on
//   their yes (push.js).
// - any other group: its rules move from deny to ask in settings.json, committed on the main branch, so Claude Code
//   asks the user each time in a session; a heartbeat, with nobody to ask, is refused them by its hook.
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { MARKER } from './template.js';
import { notProjectMessage } from './paths.js';
import { storeDir } from './store.js';
import { openDb } from './db.js';
import { addNote } from './notes.js';
import { heartbeatConfig } from './heartbeatconfig.js';
import { GROUPS, moveRules } from './limits.js';
import { SHARED_SETTINGS } from './profile.js';
import { currentBranch, lockHolder } from './runstate.js';
import { unlocked, saveUnlocked } from './unlocked.js';

export { GROUPS };
const SETTINGS = `.claude/${SHARED_SETTINGS}`;
const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

// What the lead agent is told, as a note it records as a decision at its next run or session.
function tell(dir, text, now) {
  const db = openDb(dir);
  if (!db) return;
  try {
    addNote(db, text, { source: 'mac', now });
  } finally {
    db.close();
  }
}

// The rules of a group other than push are in settings.json, which is versioned: changed and committed on the main
// branch, alone, while no run works in the project. Returns null, or why it cannot be done now.
function commitRules(dir, group, to, main) {
  if (lockHolder(dir) !== null) return 'a heartbeat is working in the project: run it again when it ends (jerome heartbeat wait).';
  if (currentBranch(dir) !== main) return `the project is not on ${main}: go back to it first.`;
  if (git(dir, 'diff', '--quiet', 'HEAD', '--', SETTINGS).status !== 0) return `${SETTINGS} has changes not committed: commit or discard them first.`;
  moveRules(dir, group, to);
  const r = git(dir, 'commit', '-q', '-m', `jerome rules: ${group} ${to === 'ask' ? 'unlocked, asked each time in sessions' : 'locked again'} (D195)`, '--', SETTINGS);
  if (r.status !== 0) {
    git(dir, 'checkout', '-q', 'HEAD', '--', SETTINGS);
    return `the commit failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`;
  }
  return null;
}

// Locks a group again, from the terminal or from the Director's dashboard (D196): the safe way, so it needs no name
// typed. Returns { ok, text }.
export function lockGroup(dir, name, { now = new Date() } = {}) {
  const project = basename(dir);
  const open = unlocked(dir);
  if (!GROUPS[name]) return { ok: false, text: `No group ${name ?? ''}.` };
  if (!open[name]) return { ok: true, text: `${name} is locked already in ${project}.` };
  const main = heartbeatConfig(dir).config.mainBranch;
  if (name !== 'push') {
    const why = commitRules(dir, name, 'deny', main);
    if (why) return { ok: false, text: `Not locked: ${why}` };
  }
  delete open[name];
  saveUnlocked(dir, open);
  if (name === 'push') {
    rmSync(join(storeDir(dir), 'push.json'), { force: true });
    tell(dir, `From the user: the push is locked again for this project, so the user pushes ${main} themselves. Record it as a decision; when work on ${main} needs a push, ask them with a decision request, as before.`, now);
  } else {
    tell(dir, `From the user: ${GROUPS[name].what} is locked again for this project. Record it as a decision; when work needs it, ask the user with a decision request, as before.`, now);
  }
  return { ok: true, text: `${name} locked again in ${project}.` };
}

// `jerome rules [dir]`, `jerome rules unlock <name> [dir]`, `jerome rules lock <name> [dir]`.
export async function rules(action, name, dirArg = '.', { input = process.stdin, output = process.stdout, env = process.env, now = new Date() } = {}) {
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, MARKER))) {
    console.error(notProjectMessage(dir));
    return 1;
  }
  const project = basename(dir);
  const open = unlocked(dir);
  const main = heartbeatConfig(dir).config.mainBranch;
  if (!action) {
    console.log(`${project}: what Jérôme blocks for the lead agent and its agents`);
    for (const [g, x] of Object.entries(GROUPS)) console.log(`  ${g.padEnd(18)} ${(open[g] ? 'unlocked' : 'locked').padEnd(9)} ${x.what}`);
    if (open.push) console.log(`\npush unlocked: Jérôme asks you on Telegram once ${main} has commits not pushed, and pushes on your yes. The lead agent still cannot push.`);
    if (Object.keys(open).some((g) => g !== 'push')) console.log('\nThe others unlocked: in your sessions Claude Code asks you each time; in heartbeats they stay refused.');
    console.log('\nUnlock one at a terminal on this Mac: jerome rules unlock <name>. Lock it again: jerome rules lock <name>.');
    return 0;
  }
  if (!GROUPS[name]) {
    console.error(`No group ${name ?? ''}. The groups: ${Object.keys(GROUPS).join(', ')}.`);
    return 2;
  }
  if (action === 'lock') {
    const r = lockGroup(dir, name, { now });
    if (!r.ok) {
      console.error(r.text);
      return 1;
    }
    console.log(`✓ ${r.text}`);
    return 0;
  }
  if (action !== 'unlock') {
    console.error('jerome rules takes unlock <name>, lock <name>, or nothing to list.');
    return 2;
  }
  if (open[name]) {
    console.log(`${name} is unlocked already in ${project}.`);
    return 0;
  }
  // Typed at a terminal: a command run by the model has none.
  if (!input.isTTY && env.JEROME_TEST_TTY !== '1') {
    console.error(`Unlocking is done at a terminal on this Mac: run jerome rules unlock ${name} there, in the project's folder.`);
    return 1;
  }
  const what = name === 'push'
    ? `Jérôme will push ${main} when you say yes on Telegram, and the push may start a deploy.`
    : `the lead agent may then ask to run ${GROUPS[name].what}: in your sessions Claude Code asks you each time, in heartbeats it stays refused.`;
  const rl = createInterface({ input, output });
  const typed = await new Promise((r) => rl.question(`Unlocking ${name} in ${project}: ${what} Type the project's name to confirm: `, r));
  rl.close();
  if (typed.trim() !== project) {
    console.log('Not unlocked: the name did not match.');
    return 1;
  }
  if (name !== 'push') {
    const why = commitRules(dir, name, 'ask', main);
    if (why) {
      console.error(`Not unlocked: ${why}`);
      return 1;
    }
  }
  open[name] = { at: now.toISOString() };
  saveUnlocked(dir, open);
  if (name === 'push') {
    tell(dir, `From the user, at the Mac: the push of ${main} is unlocked for this project. Jérôme itself asks the user with a button once ${main} has commits not pushed, and pushes on their yes; the lead agent still cannot push. Record it as a decision, replacing any decision that says the user pushes; from now on never open a request asking the user to push ${main}.`, now);
    console.log(`✓ push unlocked in ${project}. Once ${main} has commits not pushed, and no run is working, Jérôme asks you on Telegram with a button; it pushes only on your yes.`);
  } else {
    tell(dir, `From the user, at the Mac: ${GROUPS[name].what} is unlocked for this project, in sessions only: Claude Code asks the user each time it is run, and heartbeats are refused it. Record it as a decision; in a session, when the work needs it, say so and run it, and the user answers Claude Code's question. In a heartbeat, a decision request as before.`, now);
    console.log(`✓ ${name} unlocked in ${project}, committed on ${main}. In your sessions Claude Code asks you each time the lead agent runs it; heartbeats are still refused it.`);
  }
  return 0;
}
