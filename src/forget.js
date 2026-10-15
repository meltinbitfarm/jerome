// `jerome forget <key>`: removes the database of a project that is gone (D93), after a backup. `doctor` reports
// these databases; only one whose folder no longer holds a Jérôme project can be removed.
import { createInterface } from 'node:readline/promises';
import { stores, forget as remove, describeStore, storeSummary, backupsDir } from './store.js';

export async function forget(key, { yes = false } = {}) {
  const s = stores().find((x) => x.key === key);
  if (!s) {
    console.error(`There is no database ${key}. \`jerome doctor\` lists the databases of projects that are gone.`);
    return 1;
  }
  if (!s.orphan) {
    console.error(`${key} belongs to ${s.record.path}, which is still a Jérôme project: it is not removed.`);
    return 1;
  }
  console.log(`${describeStore(s)}, ${storeSummary(s)}`);
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error('Nothing was removed: run `jerome forget` in a terminal to confirm, or add --yes.');
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!/^(y|yes)$/i.test((await rl.question('Remove it, after a backup? [y/N] ')).trim())) {
        console.log('Nothing was removed.');
        return 1;
      }
    } finally {
      rl.close();
    }
  }
  try {
    const { backup } = remove(key, backupsDir());
    console.log(`✓ Removed; a backup is in ${backup}`);
    return 0;
  } catch (err) {
    console.error(`Not removed: ${err.message}`);
    return 1;
  }
}
