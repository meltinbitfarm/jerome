import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { setupChecks } from './checks.js';
import { VERSION, templatePlan, behind, isJeromeRepo, readMarker } from './template.js';
import { isProvisional, misplacedSections } from './brief.js';
import { RULE_COUNT, missingRules, addRules, isTrusted } from './limits.js';
import { agentWarnings, queueWarning } from './agents.js';
import { planHooks, applyHooks } from './hookconfig.js';
import { openDb, dbPath, schemaVersion, peekVersion, applyMigrations, LATEST, DB_FILE } from './db.js';
import {
  discoverInstalled, desiredProfile, applyProfile, readSettings, writeSettings, settingsPath,
  splitProfileKeys, ensureGitignored, inspectContext, findLeaks, overrideFor, parseTokens,
  ContextFormatError, SHARED_SETTINGS, LOCAL_SETTINGS,
} from './profile.js';

// Version of the `doctor --json` output. Adding fields keeps it; renaming or removing fields bumps it.
export const DOCTOR_SCHEMA = 'jerome.doctor/v1';

// Token budgets for the files loaded into every session. Going over them only warns, and a project can
// change them in `.jerome` under "budgets" (D37).
export const BUDGETS = { 'CLAUDE.md': 680, 'PROJECT.md': 800 };

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
    checks: [], limits: null, hooks: null, db: null, profile: null, context: null, warnings: [],
  };
  const done = () => {
    report.ok = report.checks.every((c) => c.ok);
    return report;
  };

  const isProject = existsSync(join(dir, '.jerome'));
  report.checks.push({ id: 'project', ok: isProject, label: 'Jérôme project', detail: isProject ? dir : 'the .jerome marker is missing' });
  if (!isProject) return done();
  report.warnings.push(...projectWarnings(dir));
  const limits = limitsCheck(dir, { fix });
  if (limits) {
    report.limits = { added: limits.added, missing: limits.missing };
    report.checks.push(limits.check);
  }
  const hooks = hooksCheck(dir, { fix });
  if (hooks) {
    report.hooks = hooks.hooks;
    report.checks.push(hooks.check);
    if (hooks.warning) report.warnings.push(hooks.warning);
  }
  const db = dbCheck(dir, { fix });
  report.db = db.db;
  report.checks.push(db.check);

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

  const { budgets, problems } = projectBudgets(dir);
  for (const message of problems) report.warnings.push({ id: 'budgets-config', message });
  for (const f of checkBudgets(dir, context, budgets)) {
    report.warnings.push({
      id: 'budget',
      file: f.file,
      tokens: f.tokens,
      budget: f.budget,
      message: `${f.file}: ${f.tokens} tokens, over its ${f.budget}-token budget. It is loaded into every session: move what is not needed every turn to a file read on demand, or raise the budget in .jerome if it really is.`,
    });
  }
  return done();
}

// The permission rules that make the default agent limits binding (D46, D48), in the versioned settings.json.
// With fix they are added where missing; with --check a missing rule fails the check.
// Jérôme's own repository is skipped: its pushes are part of its development, decided by the user.
function limitsCheck(dir, { fix }) {
  if (isJeromeRepo(dir)) return null;
  const label = 'Default limits';
  const rules = (n) => `${n} permission ${n === 1 ? 'rule' : 'rules'}`;
  try {
    if (fix) {
      const added = addRules(dir);
      const detail = added.length ? `${rules(added.length)} added to .claude/${SHARED_SETTINGS}` : `${rules(RULE_COUNT)} in place`;
      return { added, missing: [], check: { id: 'limits', ok: true, label, detail } };
    }
    const missing = missingRules(dir);
    const detail = missing.length
      ? `${rules(missing.length)} missing from .claude/${SHARED_SETTINGS}: run \`jerome doctor\` to add ${missing.length === 1 ? 'it' : 'them'}`
      : `${rules(RULE_COUNT)} in place`;
    return { added: [], missing, check: { id: 'limits', ok: missing.length === 0, label, detail } };
  } catch (err) {
    return { added: [], missing: [], check: { id: 'limits', ok: false, label, detail: err.message } };
  }
}

// The hooks and status line that record usage and refuse chained repo-changing commands (D59-D61), in the
// versioned settings.json. Like the permission rules, they are added with fix and fail --check when missing.
// Jérôme's own repository is skipped, as for the permission rules.
function hooksCheck(dir, { fix }) {
  if (isJeromeRepo(dir)) return null;
  const label = 'Hooks and status line';
  try {
    const plan = fix ? applyHooks(dir) : planHooks(dir);
    const warning = plan.statusline === 'other'
      ? { id: 'statusline', message: 'The project has its own status line, so interactive sessions do not record the subscription windows: make it call `jerome statusline`, which runs your own user status line and appends its part.' }
      : null;
    const hooks = { changes: fix ? plan.changes : [], pending: fix ? [] : plan.changes };
    const n = plan.changes.length;
    if (fix) return { hooks, warning, check: { id: 'hooks', ok: true, label, detail: n ? `${n} ${n === 1 ? 'change' : 'changes'} to .claude/${SHARED_SETTINGS}` : 'in place' } };
    return { hooks, warning, check: { id: 'hooks', ok: n === 0, label, detail: n ? `${n} ${n === 1 ? 'change' : 'changes'} needed: run \`jerome doctor\`` : 'in place' } };
  } catch (err) {
    return { hooks: null, warning: null, check: { id: 'hooks', ok: false, label, detail: err.message } };
  }
}

// The project database (D51, D54): created and brought to the latest schema with fix, and kept out of git.
// With --check a missing or outdated database fails the check; a database newer than this Jérôme always does.
function dbCheck(dir, { fix }) {
  const label = 'Project database';
  const fail = (detail, db = null) => ({ db, check: { id: 'db', ok: false, label, detail } });
  try {
    const ignored = !ensureGitignored(dir, { write: fix, entry: `${DB_FILE}*` });
    if (!fix) {
      if (!existsSync(dbPath(dir))) return fail(`${DB_FILE} is missing: run \`jerome doctor\` to create it`);
      const version = peekVersion(dir);
      if (version > LATEST) return fail(`${DB_FILE} has schema version ${version}, this Jérôme knows up to ${LATEST}: update Jérôme`);
      const info = { version, latest: LATEST, applied: [] };
      if (version < LATEST) return fail(`${DB_FILE} is at schema ${version} of ${LATEST}: run \`jerome doctor\` to migrate it`, info);
      if (!ignored) return fail(`${DB_FILE} is not in .gitignore: run \`jerome doctor\``, info);
      return { db: info, check: { id: 'db', ok: true, label, detail: `schema ${version}` } };
    }
    const existed = existsSync(dbPath(dir));
    const db = openDb(dir, { create: true, migrate: false });
    const applied = applyMigrations(db);
    const version = schemaVersion(db);
    db.close();
    const detail = !existed ? `${DB_FILE} created (schema ${version})` : applied.length ? `migrated to schema ${version}` : `schema ${version}`;
    return { db: { version, latest: LATEST, applied }, check: { id: 'db', ok: true, label, detail } };
  } catch (err) {
    return fail(err.message);
  }
}

// Warnings about the project's own files, which need neither the setup nor Claude Code:
// a PROJECT.md still provisional (D35), agents without a declared model or loading CLAUDE.md (D41),
// a documentation queue over its limit (D43) and template files behind the installed version (D30),
// except in Jérôme's own repository, where the template is the source and not a copy.
export function projectWarnings(dir) {
  const warnings = [];
  const project = join(dir, 'PROJECT.md');
  const content = existsSync(project) ? readFileSync(project, 'utf8') : '';
  if (isProvisional(content)) {
    warnings.push({
      id: 'provisional-project',
      message: 'PROJECT.md is provisional: open a session with `claude` so the lead agent converts brief.md, with your confirmation, before any other task.',
    });
  } else {
    const sections = misplacedSections(content);
    if (sections.length) {
      warnings.push({
        id: 'project-layout',
        sections,
        message: `PROJECT.md still holds ${sections.join(', ')}, which are loaded at every turn but belong in scope.md, read only when needed. To migrate, ask the lead agent: "move ${sections.join(', ')} from PROJECT.md to scope.md, unchanged". Run \`jerome update\` first if CLAUDE.md does not mention scope.md yet.`,
      });
    }
  }
  warnings.push(...agentWarnings(dir));
  const queue = queueWarning(dir);
  if (queue) warnings.push(queue);
  if (isJeromeRepo(dir)) return warnings;
  if (isTrusted(dir) === false) {
    warnings.push({
      id: 'trust',
      message: 'Claude Code ignores the allow rules in .claude/settings.json until you open `claude` in this folder once and accept the trust dialog; deny rules apply anyway.',
    });
  }
  try {
    const files = behind(templatePlan(dir)).map(({ path, status }) => ({ path, status }));
    if (files.length) {
      warnings.push({
        id: 'template',
        files,
        message: `${files.length} template ${files.length === 1 ? 'file is' : 'files are'} behind Jérôme ${VERSION}: run \`jerome update\` to see the changes.`,
      });
    }
  } catch (err) {
    warnings.push({ id: 'template', files: [], message: `The template files cannot be compared: ${err.message}.` });
  }
  return warnings;
}

// The budgets that apply to a project: the defaults, overridden by `"budgets"` in `.jerome` (D37).
// Invalid entries are reported and ignored, never fatal.
export function projectBudgets(dir) {
  const budgets = { ...BUDGETS };
  const problems = [];
  let custom;
  try {
    custom = readMarker(dir).budgets;
  } catch {
    return { budgets, problems };
  }
  if (custom === undefined) return { budgets, problems };
  if (typeof custom !== 'object' || custom === null || Array.isArray(custom)) {
    return { budgets, problems: ['.jerome: "budgets" must be an object such as { "PROJECT.md": 1200 }; the defaults apply.'] };
  }
  for (const [file, value] of Object.entries(custom)) {
    if (!(file in BUDGETS)) problems.push(`.jerome: no budget applies to ${file}; budgets exist for ${Object.keys(BUDGETS).join(' and ')}.`);
    else if (!Number.isInteger(value) || value <= 0) problems.push(`.jerome: the budget of ${file} must be a positive whole number of tokens; the default (${BUDGETS[file]}) applies.`);
    else budgets[file] = value;
  }
  return { budgets, problems };
}

export function checkBudgets(dir, context, budgets = BUDGETS) {
  const root = realpathSync(dir);
  return context.memoryFiles
    .filter((f) => f.type === 'Project' && dirname(f.path) === root && basename(f.path) in budgets)
    .map((f) => ({ file: basename(f.path), tokens: f.tokens, budget: budgets[basename(f.path)] }))
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
