import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, normalize, resolve } from 'node:path';
import { setupChecks, printChecks } from './checks.js';
import { ensureLeanProfile, reportProfile } from './doctor.js';

export const TEMPLATE_DIR = join(import.meta.dirname, '..', 'template');

export async function newProject(name) {
  const target = resolve(name);
  if (existsSync(target)) {
    console.error(`${target} esiste già: non tocco nulla.`);
    return 1;
  }
  // Le verifiche vengono prima di creare qualsiasi cosa, così un setup incompleto non lascia cartelle a metà.
  if (!printChecks(setupChecks())) {
    console.error('\nSetup incompleto: il progetto non è stato creato.');
    return 1;
  }

  mkdirSync(target, { recursive: true });
  copyTemplate(TEMPLATE_DIR, target);
  writeFileSync(join(target, '.jerome'), '');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
  console.log(`✓ Progetto creato in ${target}`);

  const ok = reportProfile(ensureLeanProfile(target));
  console.log(ok
    ? `\nPronto: cd ${basename(target)} && claude`
    : '\nIl progetto è creato ma il profilo non è snello: correggi quanto sopra e lancia `jerome doctor`.');
  return ok ? 0 : 1;
}

// Copia solo i percorsi elencati nel MANIFEST del template (D17).
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
      if (clean.startsWith('..') || clean.startsWith('/')) throw new Error(`Percorso non valido nel MANIFEST: ${entry}`);
      return clean;
    });
}
