import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { setupChecks } from './checks.js';
import {
  discoverInstalled, desiredProfile, applyProfile, readSettings, writeSettings, settingsPath,
  splitProfileKeys, ensureGitignored, inspectContext, findLeaks, overrideFor, parseTokens,
  ContextFormatError, SHARED_SETTINGS, LOCAL_SETTINGS,
} from './profile.js';

// Version of the `doctor --json` output. Adding fields keeps it; renaming or removing fields bumps it.
export const DOCTOR_SCHEMA = 'jerome.doctor/v1';

const VERSION = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version;

// Token budgets for the files loaded into every session (phase 2). Going over them only warns.
export const BUDGETS = { 'CLAUDE.md': 600, 'PROJECT.md': 800 };

export async function doctor(dirArg, { json = false, check = false } = {}) {
  const report = runDoctor(resolve(dirArg), { fix: !check });
  if (json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return report.ok ? 0 : 1;
}

// Runs every check and returns the report that both the human and the JSON output are built from.
// With setup: false the setup checks are skipped (jerome new has already run them).
// With fix: false (`--check`) nothing is written: needed changes are reported as pending and make the profile check fail.
export function runDoctor(dir, { setup = true, fix = true } = {}) {
  const report = {
    schema: DOCTOR_SCHEMA, ok: false, jerome: VERSION, mode: fix ? 'fix' : 'check', project: dir,
    checks: [], profile: null, context: null, warnings: [],
  };
  const done = () => {
    report.ok = report.checks.every((c) => c.ok);
    return report;
  };

  const isProject = existsSync(join(dir, '.jerome'));
  report.checks.push({ id: 'project', ok: isProject, label: 'Jérôme project', detail: isProject ? dir : 'the .jerome marker is missing' });
  if (!isProject) return done();

  if (setup) {
    const results = setupChecks();
    report.checks.push(...results);
    if (!results.every((c) => c.ok)) return done();
  }

  let result;
  try {
    result = ensureLeanProfile(dir, { fix });
  } catch (err) {
    report.checks.push({ id: 'profile', ok: false, label: 'Lean profile', detail: err.message });
    return done();
  }
  if (fix) {
    report.profile = { changes: result.changes, pending: [] };
    report.checks.push({ id: 'profile', ok: true, label: 'Lean profile', detail: result.changes.length ? 'updated' : 'already in place' });
  } else {
    const n = result.changes.length;
    report.profile = { changes: [], pending: result.changes };
    report.checks.push({
      id: 'profile',
      ok: n === 0,
      label: 'Lean profile',
      detail: n ? `${n} ${n === 1 ? 'change' : 'changes'} needed: run \`jerome doctor\` to apply ${n === 1 ? 'it' : 'them'}` : 'already in place',
    });
  }

  if (result.error) {
    const problems = result.error instanceof ContextFormatError ? result.error.problems : [result.error.message];
    report.context = result.error.sections ? { sections: result.error.sections } : null;
    report.checks.push({ id: 'context-format', ok: false, label: 'Claude Code /context output', detail: 'not recognized', problems });
    return done();
  }
  const { context, leaks } = result;
  report.checks.push({ id: 'context-format', ok: true, label: 'Claude Code /context output', detail: 'recognized' });

  const projectSkills = context.skills.filter((s) => s.source === 'Project').map((s) => s.name);
  report.context = {
    totalTokens: parseTokens(context.total),
    sections: context.sections,
    counts: {
      categories: context.categories.length,
      skills: context.skills.length,
      projectSkills: projectSkills.length,
      memoryFiles: context.memoryFiles.length,
    },
    projectSkills,
    memoryFiles: context.memoryFiles.map((f) => ({ type: f.type, file: basename(f.path), tokens: f.tokens })),
    leaks: {
      skills: leaks.skills.map(({ name, source }) => ({ name, source })),
      mcp: leaks.mcp.map(({ name, tokens }) => ({ name, tokens: parseTokens(tokens) })),
    },
  };
  const lean = leaks.skills.length === 0 && leaks.mcp.length === 0;
  report.checks.push({
    id: 'startup-context',
    ok: lean,
    label: 'Startup context',
    detail: `${context.total} estimated tokens, project skills: ${projectSkills.join(', ') || 'none'}`,
  });

  for (const f of checkBudgets(dir, context)) {
    report.warnings.push({
      id: 'budget',
      file: f.file,
      tokens: f.tokens,
      budget: f.budget,
      message: `${f.file}: ${f.tokens} tokens, over its ${f.budget}-token budget. It is loaded into every session: keep it short.`,
    });
  }
  return done();
}

export function checkBudgets(dir, context) {
  const root = realpathSync(dir);
  return context.memoryFiles
    .filter((f) => f.type === 'Project' && dirname(f.path) === root && basename(f.path) in BUDGETS)
    .map((f) => ({ file: basename(f.path), tokens: f.tokens, budget: BUDGETS[basename(f.path)] }))
    .filter((f) => f.tokens > f.budget);
}

export function printReport(report) {
  for (const check of report.checks) {
    if (check.id === 'project') {
      if (!check.ok) console.error(`${report.project} is not a Jérôme project (${check.detail}).`);
    } else if (check.id === 'profile') {
      const changes = report.profile?.changes ?? [];
      const pending = report.profile?.pending ?? [];
      if (!check.ok) {
        console.log(`✗ Lean profile — ${check.detail}`);
        for (const c of pending) console.log(`    ${c}`);
      } else if (changes.length) {
        console.log(`✓ Lean profile updated (${changes.length} ${changes.length === 1 ? 'change' : 'changes'}):`);
        for (const c of changes) console.log(`    ${c}`);
      } else console.log('✓ Lean profile already in place');
    } else if (check.id === 'context-format') {
      if (check.ok) continue;
      console.log("✗ Claude Code's /context output was not recognized; its format may have changed:");
      for (const p of check.problems) console.log(`    - ${p}`);
    } else if (check.id === 'startup-context') {
      console.log(`${check.ok ? '✓' : '✗'} Startup context: ${check.detail}`);
      for (const s of report.context.leaks.skills) console.log(`    ✗ skill still loaded: ${s.name} (${s.source})`);
      for (const c of report.context.leaks.mcp) console.log(`    ✗ ${c.name}: ${c.tokens} tokens, without a project .mcp.json`);
    } else {
      console.log(`${check.ok ? '✓' : '✗'} ${check.label}${check.detail ? ` — ${check.detail}` : ''}`);
    }
  }
  for (const w of report.warnings) console.log(`! ${w.message}`);
}

// Brings the project to the lean profile, in the git-ignored local settings, and checks with `/context`
// that it holds. A skill missed by the known sources (e.g. a personal skill) is turned off and the check runs once more.
// If `/context` cannot be read, the changes made so far are returned with the error instead of being lost.
// With fix: false nothing is written: the same changes are computed in memory and returned as needed,
// and `/context` shows what Claude Code loads with the files as they are.
export function ensureLeanProfile(dir, { fix = true } = {}) {
  const changes = [];
  if (ensureGitignored(dir, { write: fix })) changes.push(`.gitignore: added .claude/${LOCAL_SETTINGS}`);

  let settings = readSettings(dir);
  const split = splitProfileKeys(readSettings(dir, SHARED_SETTINGS));
  if (split.moved.length) {
    settings = applyProfile(settings, split.profile).settings;
    if (fix) {
      writeSettings(dir, settings);
      if (Object.keys(split.shared).length) writeSettings(dir, split.shared, SHARED_SETTINGS);
      else rmSync(settingsPath(dir, SHARED_SETTINGS));
    }
    changes.push(`moved ${split.moved.length} profile entries from ${SHARED_SETTINGS} to ${LOCAL_SETTINGS}`);
  }

  const applied = applyProfile(settings, desiredProfile(discoverInstalled()));
  if (fix && applied.changes.length) writeSettings(dir, applied.settings);
  settings = applied.settings;
  changes.push(...applied.changes);

  const hasProjectMcp = existsSync(join(dir, '.mcp.json'));
  try {
    let context = inspectContext(dir);
    let leaks = findLeaks(context, { hasProjectMcp });

    const extra = {};
    for (const skill of leaks.skills) {
      const name = overrideFor(skill);
      if (name && settings.skillOverrides?.[name] !== 'off') extra[name] = 'off';
    }
    if (Object.keys(extra).length) {
      const patched = applyProfile(settings, { skillOverrides: extra });
      changes.push(...patched.changes);
      if (fix) {
        writeSettings(dir, patched.settings);
        context = inspectContext(dir);
        leaks = findLeaks(context, { hasProjectMcp });
      }
    }
    return { changes, context, leaks };
  } catch (error) {
    return { changes, error };
  }
}
