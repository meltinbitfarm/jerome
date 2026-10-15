// `jerome update`: brings the template files of an existing project up to the installed version (D30).
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { TEMPLATE_DIR, VERSION, MARKER, templatePlan, behind, reconciled, writeMarker, isJeromeRepo } from './template.js';
import { notProjectMessage, isLegacy, isProject } from './paths.js';
import { layoutPlan, describeLayoutPlan, migrateLayout, busy } from './migrate.js';
import { jobLabel } from './schedule.js';
import { homedir } from 'node:os';

const LABELS = { new: 'new', update: 'update', modified: 'changed here', remove: 'remove' };

export async function update(dirArg, { check = false, yes = false } = {}) {
  const dir = resolve(dirArg);
  // A project from before D87 first moves to the .jerome/ layout (D89), once, after confirmation.
  if (isLegacy(dir) && !isProject(dir)) {
    const result = await migrate(dir, { check, yes });
    if (result !== 0) return result;
  }
  if (!existsSync(join(dir, MARKER))) {
    console.error(notProjectMessage(dir));
    return 1;
  }
  if (isJeromeRepo(dir)) {
    console.error(`${dir} is Jérôme's own repository: its template lives in template/, there is nothing to update.`);
    return 1;
  }
  let plan;
  try {
    plan = templatePlan(dir);
  } catch (err) {
    console.error(`Cannot compare the project with the template: ${err.message}`);
    return 1;
  }

  const todo = behind(plan);
  for (const path of plan.dropped) console.log(`! ${path} is no longer in the template, but it was changed in this project or has no record: left in place, delete it if you don't need it`);
  if (!todo.length) {
    // A project from before D30 still gets its record, so the next updates can tell its changes apart.
    if (!check && plan.marker.jerome === null) writeMarker(dir, reconciled(dir, plan));
    console.log(`✓ Template files up to date with Jérôme ${VERSION}`);
    return 0;
  }

  console.log(`Template files behind Jérôme ${VERSION}:`);
  for (const f of todo) console.log(`  ${LABELS[f.status].padEnd(12)} ${f.path}`);
  for (const f of todo) printDiff(dir, f);
  if (check) return 1;

  const clean = todo.filter((f) => f.status !== 'modified');
  const modified = todo.filter((f) => f.status === 'modified');
  const apply = [];
  const kept = [];

  if (yes) {
    apply.push(...clean);
    for (const f of modified) console.log(`! ${f.path} was changed in this project: left as it is. Run \`jerome update\` in a terminal to choose.`);
  } else if (!process.stdin.isTTY) {
    console.error('\nNothing was changed: run `jerome update` in a terminal to choose, or add --yes to apply the files not changed in the project.');
    return 1;
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (clean.length && await confirm(rl, `\nApply the ${clean.length} ${clean.length === 1 ? 'change' : 'changes'} to files not changed in this project?`)) apply.push(...clean);
      for (const f of modified) {
        if (await confirm(rl, `${f.path} was changed in this project. Replace it with the template's version?`)) apply.push(f);
        else kept.push(f.path);
      }
    } finally {
      rl.close();
    }
  }

  for (const f of apply) {
    const target = join(dir, f.path);
    if (f.status === 'remove') {
      rmSync(target);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(TEMPLATE_DIR, f.path), target);
  }
  writeMarker(dir, reconciled(dir, plan, kept));
  const removed = apply.filter((f) => f.status === 'remove').length;
  const updated = apply.length - removed;
  console.log(`✓ ${updated} ${updated === 1 ? 'file' : 'files'} updated${removed ? `, ${removed} removed` : ''}${kept.length ? `, ${kept.length} kept as changed in this project` : ''}`);
  return 0;
}

async function migrate(dir, { check, yes }) {
  let plan;
  try {
    plan = layoutPlan(dir);
  } catch (err) {
    console.error(`Cannot read the project's layout: ${err.message}`);
    return 1;
  }
  console.log(`This project keeps Jérôme's files at its root. Jérôme ${VERSION} keeps them in .jerome/ and the lead agent's instructions in .claude/rules/jerome.md:`);
  console.log(describeLayoutPlan(plan));
  if (check) return 1;
  const lock = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'jerome', 'locks', `${jobLabel(dir)}.lock`);
  const why = busy(dir, lock);
  if (why) {
    console.error(`\nNot now: ${why}. Nothing was moved.`);
    return 1;
  }
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error('\nNothing was moved: run `jerome update` in a terminal to confirm, or add --yes.');
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!await confirm(rl, '\nMove them?')) {
        console.log('Nothing was moved.');
        return 1;
      }
    } finally {
      rl.close();
    }
  }
  let moved;
  try {
    moved = migrateLayout(dir, plan);
  } catch (err) {
    console.error(`\nNot moved: ${err.message}`);
    return 1;
  }
  console.log(`✓ Moved to .jerome/ (tracked files with git mv: review and commit the moves)${plan.keepLead ? '. CLAUDE.md was changed in this project and stays as its own: check that it does not repeat or contradict .claude/rules/jerome.md' : ''}`);
  if (moved.db) {
    const rows = Object.entries(moved.db.rows).map(([t, n]) => `${n} ${t}`).join(', ');
    console.log(`  database: ${rows}, copied and checked; a backup is in ${moved.db.backup}`);
  }
  // Git deletes ignored files that stand where it must put a tracked one: checking out a branch or commit from
  // before the move, where .jerome is a file, removes .jerome/jerome.db (D92).
  console.log('! Move on the branch you keep working on, and commit there. Checking out a branch or commit from before the move deletes .jerome/jerome.db: git removes ignored files that stand where it must put .jerome as a file. Merge or delete those branches, and keep the backup until then.');
  return 0;
}

async function confirm(rl, question) {
  return /^(y|yes)$/i.test((await rl.question(`${question} [y/N] `)).trim());
}

// Shows what would change, from the project's version to the template's. The header lines name the two sides
// project/<path> and template/<path> instead of the absolute paths git prints.
function printDiff(dir, f) {
  const from = f.status === 'new' ? '/dev/null' : join(dir, f.path);
  const to = f.status === 'remove' ? '/dev/null' : join(TEMPLATE_DIR, f.path);
  const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--', from, to], { encoding: 'utf8' });
  const lines = (r.stdout ?? '').trimEnd().split('\n');
  const hunk = lines.findIndex((l) => l.startsWith('@@'));
  if (hunk === -1) return;
  const header = [`--- ${f.status === 'new' ? '/dev/null' : `project/${f.path}`}`, `+++ ${f.status === 'remove' ? '/dev/null' : `template/${f.path}`}`];
  console.log(`\n${[...header, ...lines.slice(hunk)].join('\n')}`);
}
