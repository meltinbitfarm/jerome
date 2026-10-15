// `jerome update`: brings the template files of an existing project up to the installed version (D30).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { TEMPLATE_DIR, VERSION, MARKER, templatePlan, behind, reconciled, writeMarker, isJeromeRepo } from './template.js';

const LABELS = { new: 'new', update: 'update', modified: 'changed here' };

export async function update(dirArg, { check = false, yes = false } = {}) {
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, MARKER))) {
    console.error(`${dir} is not a Jérôme project (the ${MARKER} marker is missing).`);
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
  for (const path of plan.dropped) console.log(`! ${path} is no longer in the template: left in place, delete it if you don't need it`);
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
      if (clean.length && await confirm(rl, `\nApply ${clean.length} ${clean.length === 1 ? 'file' : 'files'} not changed in this project?`)) apply.push(...clean);
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
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(TEMPLATE_DIR, f.path), target);
  }
  writeMarker(dir, reconciled(dir, plan, kept));
  console.log(`✓ ${apply.length} ${apply.length === 1 ? 'file' : 'files'} updated${kept.length ? `, ${kept.length} kept as changed in this project` : ''}`);
  return 0;
}

async function confirm(rl, question) {
  return /^(y|yes)$/i.test((await rl.question(`${question} [y/N] `)).trim());
}

// Shows what would change, from the project's version to the template's. The header lines name the two sides
// project/<path> and template/<path> instead of the absolute paths git prints.
function printDiff(dir, f) {
  const from = f.status === 'new' ? '/dev/null' : join(dir, f.path);
  const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--', from, join(TEMPLATE_DIR, f.path)], { encoding: 'utf8' });
  const lines = (r.stdout ?? '').trimEnd().split('\n');
  const hunk = lines.findIndex((l) => l.startsWith('@@'));
  if (hunk === -1) return;
  const header = [`--- ${f.status === 'new' ? '/dev/null' : `project/${f.path}`}`, `+++ template/${f.path}`];
  console.log(`\n${[...header, ...lines.slice(hunk)].join('\n')}`);
}
