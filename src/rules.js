// What Jérôme blocks for the model, and what the user unlocked for one project (D194). The groups are the deny rules
// of limits.js, by name. The choice is kept in the project's store, outside the repository, so no run changes it
// with a commit, and unlocking asks for the project's name typed at a terminal. Unlocked, `push` is still not the
// model's: Jérôme asks the user with a button once the main branch has commits not pushed, and pushes on their yes
// (push.js). The other groups cannot be unlocked yet.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { MARKER } from './template.js';
import { notProjectMessage } from './paths.js';
import { storeDir } from './store.js';
import { openDb } from './db.js';
import { addNote } from './notes.js';
import { heartbeatConfig } from './heartbeatconfig.js';
import { DENY_RULES } from './limits.js';

const pick = (re) => DENY_RULES.filter((r) => re.test(r));
export const GROUPS = {
  push: { what: 'pushing with git', rules: pick(/^Bash\(git (-C \* )?push/), ready: true },
  'gh-merge': { what: 'merging a pull request on GitHub', rules: pick(/^Bash\(gh pr merge/) },
  'gh-release': { what: 'a release on GitHub', rules: pick(/^Bash\(gh release/) },
  publish: { what: 'publishing packages (npm, pnpm, yarn, bun, cargo, PyPI, gems)', rules: pick(/^Bash\((npm|pnpm|yarn|bun|cargo|twine|uv|poetry|gem) .*(publish|upload|push)/) },
  'docker-push': { what: 'pushing Docker images', rules: pick(/^Bash\(docker push/) },
  'deploy-vercel': { what: 'deploying on Vercel', rules: pick(/^Bash\(vercel/) },
  'deploy-netlify': { what: 'deploying on Netlify', rules: pick(/^Bash\(netlify/) },
  'deploy-firebase': { what: 'deploying on Firebase', rules: pick(/^Bash\(firebase/) },
  'deploy-fly': { what: 'deploying on Fly.io', rules: pick(/^Bash\(fly(ctl)? /) },
  'deploy-cloudflare': { what: 'deploying on Cloudflare', rules: pick(/^Bash\(wrangler/) },
  email: { what: 'sending email', rules: pick(/^Bash\((sendmail|mail|mailx)\b/) },
};

const unlockedPath = (dir) => join(storeDir(dir), 'unlocked.json');

// The groups unlocked for the project: { push: { at } }.
export function unlocked(dir) {
  try {
    return JSON.parse(readFileSync(unlockedPath(dir), 'utf8'));
  } catch {
    return {};
  }
}

export const isUnlocked = (dir, name) => Boolean(unlocked(dir)[name]);

function save(dir, data) {
  mkdirSync(storeDir(dir), { recursive: true });
  if (!Object.keys(data).length) rmSync(unlockedPath(dir), { force: true });
  else writeFileSync(unlockedPath(dir), `${JSON.stringify(data, null, 2)}\n`);
}

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

// `jerome rules [dir]`, `jerome rules unlock <name> [dir]`, `jerome rules lock <name> [dir]`.
export async function rules(action, name, dirArg = '.', { input = process.stdin, output = process.stdout, env = process.env, now = new Date() } = {}) {
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, MARKER))) {
    console.error(notProjectMessage(dir));
    return 1;
  }
  const project = basename(dir);
  const open = unlocked(dir);
  if (!action) {
    console.log(`${project}: what Jérôme blocks for the lead agent and its agents`);
    for (const [g, x] of Object.entries(GROUPS)) console.log(`  ${g.padEnd(18)} ${(open[g] ? 'unlocked' : 'locked').padEnd(9)} ${x.what}`);
    if (open.push) console.log(`\npush unlocked: Jérôme asks you on Telegram once ${heartbeatConfig(dir).config.mainBranch} has commits not pushed, and pushes on your yes. The lead agent still cannot push.`);
    console.log('\nUnlock one at a terminal on this Mac: jerome rules unlock <name>. Lock it again: jerome rules lock <name>.');
    return 0;
  }
  if (!GROUPS[name]) {
    console.error(`No group ${name ?? ''}. The groups: ${Object.keys(GROUPS).join(', ')}.`);
    return 2;
  }
  const main = heartbeatConfig(dir).config.mainBranch;
  if (action === 'lock') {
    if (!open[name]) {
      console.log(`${name} is locked already in ${project}.`);
      return 0;
    }
    delete open[name];
    save(dir, open);
    if (name === 'push') {
      rmSync(join(storeDir(dir), 'push.json'), { force: true });
      tell(dir, `From the user, at the Mac: the push is locked again for this project, so the user pushes ${main} themselves. Record it as a decision; when work on ${main} needs a push, ask them with a decision request, as before.`, now);
    }
    console.log(`✓ ${name} locked again in ${project}.`);
    return 0;
  }
  if (action !== 'unlock') {
    console.error('jerome rules takes unlock <name>, lock <name>, or nothing to list.');
    return 2;
  }
  if (!GROUPS[name].ready) {
    console.error(`${name} cannot be unlocked yet: only push can, for now.`);
    return 1;
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
  const rl = createInterface({ input, output });
  const typed = await new Promise((r) => rl.question(`Unlocking push in ${project}: Jérôme will push ${main} when you say yes on Telegram, and the push may start a deploy. Type the project's name to confirm: `, r));
  rl.close();
  if (typed.trim() !== project) {
    console.log('Not unlocked: the name did not match.');
    return 1;
  }
  open[name] = { at: now.toISOString() };
  save(dir, open);
  tell(dir, `From the user, at the Mac: the push of ${main} is unlocked for this project. Jérôme itself asks the user with a button once ${main} has commits not pushed, and pushes on their yes; the lead agent still cannot push. Record it as a decision, replacing any decision that says the user pushes; from now on never open a request asking the user to push ${main}.`, now);
  console.log(`✓ push unlocked in ${project}. Once ${main} has commits not pushed, and no run is working, Jérôme asks you on Telegram with a button; it pushes only on your yes.`);
  return 0;
}
