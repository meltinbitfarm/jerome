import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { setupChecks, printChecks } from './checks.js';
import { runDoctor, printReport } from './doctor.js';
import { TEMPLATE_DIR, readManifest, templatePlan, reconciled, writeMarker } from './template.js';
import { stripFences, parseBrief, projectFiles, provisionalProject } from './brief.js';

export async function newProject(name, { fromFile } = {}) {
  const target = resolve(name);

  // The brief is read and checked before anything else, so a brief that cannot be imported creates nothing.
  let state = null;
  if (fromFile !== undefined) {
    state = readBrief(fromFile);
    if (typeof state === 'number') return state;
  }

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
  writeMarker(target, reconciled(target, templatePlan(target)));
  if (state) for (const [file, content] of Object.entries(state.files)) writeFileSync(join(target, file), content);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
  console.log(`✓ Project created in ${target}`);
  if (state) console.log(state.message);

  const report = runDoctor(target, { setup: false });
  printReport(report);
  const ok = report.ok;
  console.log(ok
    ? `\nReady: cd ${basename(target)} && claude`
    : '\nThe project was created but the profile is not lean: fix the issues above and run `jerome doctor`.');
  return ok ? 0 : 1;
}

// Reads the brief from a file, or from standard input with `-`, and returns the project files to write
// with a message for the user, or an exit code when the brief cannot be imported (D35).
function readBrief(path) {
  let raw;
  try {
    raw = readFileSync(path === '-' ? 0 : path, 'utf8');
  } catch (err) {
    console.error(`Cannot read the brief from ${path === '-' ? 'standard input' : path}: ${err.message}`);
    return 1;
  }
  const text = stripFences(raw);
  if (!text) {
    console.error(`The brief from ${path === '-' ? 'standard input' : path} is empty: nothing was created.`);
    return 1;
  }
  const brief = parseBrief(text);
  if (brief.kind === 'unknown-format') {
    console.error(`The brief is in ${brief.format}, which this version of Jérôme cannot read: update Jérôme. Nothing was created.`);
    return 1;
  }
  const original = { 'brief.md': `${text}\n` };
  if (brief.kind === 'text') {
    return {
      files: { ...original, 'PROJECT.md': provisionalProject(brief.reasons) },
      message: `! brief.md is not a valid brief/v2 (${brief.reasons.join('; ')}): saved as it is.\n  The lead agent will convert it in the first session, asking you to confirm the decisions it finds.`,
    };
  }
  const files = projectFiles(brief);
  const ignored = brief.ignored.map((w) => `\n! Ignored ${w}`).join('');
  const draft = brief.meta.status === 'draft' ? '\n! The brief is a draft (status: draft): its open questions come first.' : '';
  const from = brief.format === 'brief/v1' ? ' (brief/v1, headings mapped to brief/v2)' : '';
  return {
    files: { ...original, ...files },
    message: `✓ Brief imported${from}: PROJECT.md, decisions.md, open.md and brief.md${ignored}${draft}`,
  };
}

// Copies only the paths listed in the template's MANIFEST (D17).
export function copyTemplate(templateDir, target) {
  for (const entry of readManifest(templateDir)) {
    cpSync(join(templateDir, entry), join(target, entry), { recursive: true, errorOnExist: true, force: false });
  }
}
