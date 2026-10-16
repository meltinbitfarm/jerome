import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { setupChecks, printChecks } from './checks.js';
import { runDoctor, printReport } from './doctor.js';
import { TEMPLATE_DIR, MARKER, readManifest, manifestFiles, templatePlan, reconciled, writeMarker } from './template.js';
import { JEROME_DIR, STATE, isProject, isLegacy, notProjectMessage } from './paths.js';
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
    console.error(`${target} already exists: nothing was changed. To bring Jérôme into an existing project, use \`jerome init\`.`);
    return 1;
  }
  // The checks come before creating anything, so an incomplete setup leaves no half-made folders.
  if (!printChecks(setupChecks())) {
    console.error('\nIncomplete setup: the project was not created.');
    return 1;
  }

  mkdirSync(target, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
  adopt(target, state);
  console.log(`✓ Project created in ${target}`);
  if (state) console.log(state.message);
  return finish(target, `cd ${basename(target)} && claude`);
}

// `jerome init [dir]` (D88): brings Jérôme into an existing project. It never overwrites a file: the project's
// CLAUDE.md, .claude/CLAUDE.md and docs/ stay as they are, a template file the project already has differently is
// left and reported, settings.json only gets Jérôme's keys and .gitignore only the missing lines (through doctor).
export async function initProject(dirArg, { fromFile } = {}) {
  const target = resolve(dirArg);
  if (!existsSync(target)) {
    console.error(`${target} does not exist: use \`jerome new\` to create a project.`);
    return 1;
  }
  if (isProject(target)) {
    console.error(`${target} is already a Jérôme project: nothing was changed.`);
    return 1;
  }
  if (isLegacy(target)) {
    console.error(notProjectMessage(target));
    return 1;
  }
  let state = null;
  if (fromFile !== undefined) {
    state = readBrief(fromFile);
    if (typeof state === 'number') return state;
    for (const file of Object.keys(state.files)) {
      if (existsSync(join(target, file))) {
        console.error(`${file} already exists in ${target}: nothing was changed.`);
        return 1;
      }
    }
  }
  if (!printChecks(setupChecks())) {
    console.error('\nIncomplete setup: nothing was changed.');
    return 1;
  }
  const kept = adopt(target, state);
  console.log(`✓ Jérôme added to ${target}`);
  for (const file of kept) console.log(`! ${file} already exists and differs from Jérôme's: left as it is.`);
  if (state) console.log(state.message);
  if (!existsSync(join(target, '.git'))) console.log('! This folder is not a git repository: heartbeats need one (`git init`, then a first commit).');
  const next = state
    ? `cd ${basename(target)} && claude`
    : `cd ${basename(target)} && claude, then ask for the briefing: the lead agent reads the project and its own instructions first`;
  return finish(target, next);
}

// Copies the template files the project does not have and records them in .jerome/project.json; returns the
// template files that already existed with different content, which are left untouched.
function adopt(target, state) {
  const kept = [];
  for (const entry of readManifest(TEMPLATE_DIR)) {
    for (const file of manifestFiles(TEMPLATE_DIR, [entry])) {
      const to = join(target, file);
      if (existsSync(to)) {
        if (readFileSync(to, 'utf8') !== readFileSync(join(TEMPLATE_DIR, file), 'utf8')) kept.push(file);
        continue;
      }
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(join(TEMPLATE_DIR, file), to);
    }
  }
  mkdirSync(join(target, JEROME_DIR), { recursive: true });
  writeFileSync(join(target, MARKER), '');
  writeMarker(target, reconciled(target, templatePlan(target)));
  if (state) {
    for (const [file, content] of Object.entries(state.files)) {
      mkdirSync(dirname(join(target, file)), { recursive: true });
      writeFileSync(join(target, file), content);
    }
  }
  return kept;
}

async function finish(target, next) {
  const report = await runDoctor(target, { setup: false });
  printReport(report);
  const ok = report.ok;
  console.log(ok
    ? `\nReady: ${next}`
    : '\nJérôme is in place but the profile is not lean: fix the issues above and run `jerome doctor`.');
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
  const original = { [STATE.brief]: `${text}\n` };
  if (brief.kind === 'text') {
    return {
      files: { ...original, [STATE.project]: provisionalProject(brief.reasons) },
      message: `! .jerome/brief.md is not a valid brief/v3 (${brief.reasons.join('; ')}): saved as it is.\n  The lead agent will convert it in the first session, asking you to confirm the decisions it finds.`,
    };
  }
  const files = projectFiles(brief);
  const ignored = brief.ignored.map((w) => `\n! Ignored ${w}`).join('');
  const draft = brief.meta.status === 'draft' ? '\n! The brief is a draft (status: draft): its open questions come first.' : '';
  const from = brief.format === 'brief/v1' ? ' (brief/v1, headings mapped to brief/v3)' : brief.format === 'brief/v2' ? ' (brief/v2)' : '';
  return {
    files: { ...original, ...files },
    message: `✓ Brief imported${from} into .jerome/: PROJECT.md, scope.md, areas.md, decisions.md, open.md and brief.md${ignored}${draft}`,
  };
}
