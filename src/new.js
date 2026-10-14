import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, normalize, resolve } from 'node:path';
import { setupChecks, printChecks } from './checks.js';
import { ensureLeanProfile, reportProfile } from './doctor.js';

export const TEMPLATE_DIR = join(import.meta.dirname, '..', 'template');

export async function newProject(name) {
  const target = resolve(name);
  if (existsSync(target)) {
    console.error(`${target} already exists: nothing was changed.`);
    return 1;
  }
  // The checks come before creating anything, so an incomplete setup leaves no half-made folders.
  if (!printChecks(setupChecks())) {
    console.error('\nIncomplete setup: the project was not created.');
    return 1;
  }

  mkdirSync(target, { recursive: true });
  copyTemplate(TEMPLATE_DIR, target);
  writeFileSync(join(target, '.jerome'), '');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
  console.log(`✓ Project created in ${target}`);

  const ok = reportProfile(ensureLeanProfile(target));
  console.log(ok
    ? `\nReady: cd ${basename(target)} && claude`
    : '\nThe project was created but the profile is not lean: fix the issues above and run `jerome doctor`.');
  return ok ? 0 : 1;
}

// Copies only the paths listed in the template's MANIFEST (D17).
export function copyTemplate(templateDir, target) {
  for (const entry of readManifest(templateDir)) {
    cpSync(join(templateDir, entry), join(target, entry), { recursive: true, errorOnExist: true, force: false });
  }
}

export function readManifest(templateDir) {
  return readFileSync(join(templateDir, 'MANIFEST'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((entry) => {
      const clean = normalize(entry).replace(/\/$/, '');
      if (clean.startsWith('..') || clean.startsWith('/')) throw new Error(`Invalid path in MANIFEST: ${entry}`);
      return clean;
    });
}
