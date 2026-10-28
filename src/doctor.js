import { existsSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { setupChecks } from './checks.js';
import { notProjectMessage, isLegacy, LEAD_FILE, STATE, DB_IGNORE, LEGACY, PROJECT_FILE, TREE_DB } from './paths.js';
import { startProgress } from './progress.js';
import { VERSION, templatePlan, behind, isJeromeRepo, readMarker } from './template.js';
import { isProvisional, misplacedSections } from './brief.js';
import { RULE_COUNT, missingRules, addRules, isTrusted } from './limits.js';
import { agentWarnings, queueWarning, projectAgents } from './agents.js';
import { areaWarnings } from './areas.js';
import { planHooks, applyHooks } from './hookconfig.js';
import { latestSession, toolProblems } from './session-shape.js';
import { projectLimitSettings } from './budget.js';
import { heartbeatProblems, rescheduleCommand, launchAgentsDir, launchd, WATCHDOG_LABEL } from './schedule.js';
import { readConfig as readTelegram, configPath as telegramConfigPath } from './telegram.js';
import { heartbeatConfig } from './heartbeatconfig.js';
import { openDb, dbPath, treeDb, schemaVersion, peekVersion, applyMigrations, LATEST } from './db.js';
import { candidates, relink, stores, describeStore, storeSummary } from './store.js';
import { createInterface } from 'node:readline/promises';
import {
  discoverInstalled, desiredProfile, applyProfile, readSettings, writeSettings, settingsPath,
  splitProfileKeys, ensureGitignored, inspectContext, findLeaks, overrideFor, parseTokens, projectPlugins, isProjectPluginSkill,
  ContextFormatError, SHARED_SETTINGS, LOCAL_SETTINGS,
} from './profile.js';

// Version of the `doctor --json` output. Adding fields keeps it; renaming or removing fields bumps it.
export const DOCTOR_SCHEMA = 'jerome.doctor/v1';

// Token budgets for the files loaded into every session. Going over them only warns, and a project can
// change them in `.jerome` under "budgets" (D37).
// Keyed by file name: jerome.md is the lead agent's instructions (D87), CLAUDE.md before it.
export const BUDGETS = { 'jerome.md': 850, 'PROJECT.md': 800 };

export async function doctor(dirArg, { json = false, check = false, yes = false, relink: relinkKey = null, newDb = false } = {}) {
  const ask = !json && process.stdin.isTTY ? askChoice : null;
  const report = await runDoctor(resolve(dirArg), { fix: !check, db: { yes, relinkKey, newDb, ask } });
  if (json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return report.ok ? 0 : 1;
}

// Runs every check and returns the report that both the human and the JSON output are built from.
// With setup: false the setup checks are skipped (jerome new has already run them).
// With fix: false (`--check`) nothing is written: needed changes are reported as pending and make the profile check fail.
export async function runDoctor(dir, { setup = true, fix = true, db: dbOptions = {} } = {}) {
  const report = {
    schema: DOCTOR_SCHEMA, ok: false, jerome: VERSION, mode: fix ? 'fix' : 'check', project: dir,
    checks: [], limits: null, hooks: null, db: null, profile: null, context: null, warnings: [],
  };
  const done = () => {
    report.ok = report.checks.every((c) => c.ok);
    return report;
  };

  const isProject = existsSync(join(dir, PROJECT_FILE));
  report.checks.push({ id: 'project', ok: isProject, label: 'Jérôme project', detail: isProject ? dir : notProjectMessage(dir) });
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
  const beat = heartbeatCheck(dir);
  if (beat) report.checks.push(beat);
  // Settings of the autonomous runs that cannot be used (D118): their defaults apply.
  for (const message of heartbeatConfig(dir).problems) report.warnings.push({ id: 'heartbeat-config', message });
  for (const message of watchdogWarnings(dir)) report.warnings.push({ id: 'watchdog', message });
  const db = await dbCheck(dir, { fix, ...dbOptions });
  report.db = db.db;
  report.checks.push(db.check);
  const orphans = orphanWarning(db.offered ?? []);
  if (orphans) report.warnings.push(orphans);

  if (setup) {
    const results = setupChecks();
    report.checks.push(...results);
    if (!results.every((c) => c.ok)) return done();
  }

  let result;
  try {
    result = await ensureLeanProfile(dir, { fix });
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
  const { context, leaks, plugins } = result;
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
  // What the project's own plugins cost at every session, since they stay on (D113).
  for (const id of plugins ?? []) {
    const skills = context.skills.filter((s) => isProjectPluginSkill(s, [id]));
    const tokens = skills.reduce((sum, s) => sum + (parseTokens(s.tokens) ?? 0), 0);
    report.warnings.push({ id: 'project-plugins', plugin: id, skills: skills.length, tokens,
      message: `${id} is enabled by the project's settings.json, so the lean profile leaves it on: ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}, about ${tokens.toLocaleString('en')} tokens in every session.` });
  }
  // Two figures (D81): /context's estimate, which with -p counts the headless tool set, and the real first call of
  // the latest session, read from its transcript.
  const last = lastSessionReport(dir);
  report.context.lastSession = last.session;
  report.context.tools = last.tools;
  const real = last.session
    ? `; first call of the latest session (${last.session.kind}, ${shortDate(last.session.at)}): ${last.session.tokens.toLocaleString('en')} tokens`
    : '; no session yet to measure the first call';
  report.checks.push({
    id: 'startup-context',
    ok: lean,
    label: 'Startup context',
    detail: `${context.total} estimated headless (/context)${real}; project skills: ${projectSkills.join(', ') || 'none'}`,
  });
  if (last.warning) report.warnings.push(last.warning);
  report.context.instructions = instructionFiles(dir, context);

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

// The latest session's real first call, and the tools it was sent, checked against the deny rules (D80, D81).
// A session older than the last change to settings.json says nothing about the current rules: not checked.
function lastSessionReport(dir) {
  let found;
  try {
    found = latestSession(dir);
  } catch {
    return { session: null, tools: null, warning: null };
  }
  if (!found) return { session: null, tools: null, warning: null };
  let kind = 'session';
  const db = existsSync(dbPath(dir)) ? openDb(dir, { readOnly: true, migrate: false }) : null;
  try {
    kind = db?.prepare('SELECT kind FROM runs WHERE session_id = ?').get(found.sessionId)?.kind ?? kind;
  } catch {
    // An older schema: the kind stays generic.
  } finally {
    db?.close();
  }
  const session = { sessionId: found.sessionId, kind, tokens: found.firstCall.tokens, at: found.firstCall.at };
  const shared = settingsPath(dir, SHARED_SETTINGS);
  const changed = existsSync(shared) ? statSync(shared).mtimeMs : 0;
  if (found.firstCall.at && Date.parse(found.firstCall.at) < changed) {
    return { session, tools: { checked: false, reason: 'the latest session started before the last change to .claude/settings.json' }, warning: null };
  }
  const problems = toolProblems(found);
  if (!problems) return { session, tools: { checked: false, reason: 'the transcript has no record of the request' }, warning: null };
  const tools = { checked: true, sent: found.tools, ...problems };
  const parts = [];
  if (problems.deniedSent.length) parts.push(`denied tools still sent: ${problems.deniedSent.join(', ')}`);
  if (problems.deniedAgents.length) parts.push(`denied agents still listed: ${problems.deniedAgents.join(', ')}`);
  if (problems.unexpected.length) parts.push(`unexpected tools: ${problems.unexpected.map((t) => `${t.name} (${t.chars.toLocaleString('en')} characters)`).join(', ')}`);
  const warning = parts.length
    ? { id: 'context-tools', ...problems, message: `The latest session sent more than the deny rules allow: ${parts.join('; ')}. Claude Code may have renamed or added a tool: check \`jerome deps\` and the deny rules.` }
    : null;
  return { session, tools, warning };
}

function shortDate(iso) {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

// A scheduled heartbeat (D72): its launchd job must be there and loaded, and run paths that still exist.
// Without a schedule in .jerome there is no check.
function heartbeatCheck(dir) {
  let h;
  try {
    h = readMarker(dir).heartbeat;
  } catch {
    return null;
  }
  if (!h) return null;
  const problems = heartbeatProblems(dir);
  return problems.length
    ? { id: 'heartbeat', ok: false, label: 'Heartbeat job', detail: `${problems.join('; ')}: reschedule with \`${rescheduleCommand(dir, h)}\`` }
    : { id: 'heartbeat', ok: true, label: 'Heartbeat job', detail: 'scheduled and loaded' };
}

// The project database (D51, D54, D93): created and brought to the latest schema with fix; it lives outside the
// working tree. With --check a missing or outdated database fails the check; a database newer than this Jérôme
// always does. When it is missing and orphan databases of the same repository exist, the project may have moved:
// one is relinked only with a person's choice, or with --yes when it is the only one; nothing is created meanwhile.
async function dbCheck(dir, { fix, yes = false, relinkKey = null, newDb = false, ask = null }) {
  const label = 'Project database';
  const fail = (detail, db = null, offered = []) => ({ db, offered, check: { id: 'db', ok: false, label, detail } });
  try {
    // Kept in .gitignore, so a Jérôme from before D93 never puts a database it creates in .jerome/ into git.
    const ignored = !ensureGitignored(dir, { write: fix, entry: DB_IGNORE });
    if (treeDb(dir)) return fail(`still in the working tree (${TREE_DB}), where a checkout or \`git clean -X\` can delete it: run \`jerome update\` to move it out`);
    let relinked = null;
    if (!existsSync(dbPath(dir)) && !newDb) {
      const found = relinkKey ? stores().filter((s) => s.key === relinkKey && s.orphan) : candidates(dir);
      if (relinkKey && !found.length) return fail(`${relinkKey} is not a database left by a project that moved`);
      if (found.length) {
        const list = found.map((s) => `${describeStore(s)}, ${storeSummary(s)}`).join('; ');
        if (!fix) return fail(`missing, and ${found.length === 1 ? 'a database' : `${found.length} databases`} of this repository left by a folder that no longer holds the project: ${list}. Run \`jerome doctor\` to relink`, null, found);
        let chosen = null;
        if (relinkKey || (yes && found.length === 1)) chosen = found[0];
        else if (!yes && ask) chosen = await ask(found);
        if (!chosen) {
          const how = found.length === 1 && !yes ? `\`jerome doctor --yes\` relinks it` : `choose with \`jerome doctor --relink <key>\``;
          return fail(`missing, and not relinked: ${list}. ${how}, or \`jerome doctor --new-db\` starts an empty one instead. Nothing was created`, null, found);
        }
        relink(dir, chosen);
        relinked = { key: chosen.key, from: chosen.record?.path ?? null };
      }
    }
    if (!fix) {
      if (!existsSync(dbPath(dir))) return fail('missing: run `jerome doctor` to create it');
      const version = peekVersion(dir);
      if (version > LATEST) return fail(`schema version ${version}, this Jérôme knows up to ${LATEST}: update Jérôme`);
      const info = { version, latest: LATEST, applied: [], path: dbPath(dir) };
      if (version < LATEST) return fail(`at schema ${version} of ${LATEST}: run \`jerome doctor\` to migrate it`, info);
      if (!ignored) return fail(`${DB_IGNORE} is not in .gitignore: run \`jerome doctor\``, info);
      return { db: info, check: { id: 'db', ok: true, label, detail: `schema ${version}` } };
    }
    const existed = existsSync(dbPath(dir));
    const db = openDb(dir, { create: true, migrate: false });
    const applied = applyMigrations(db);
    const version = schemaVersion(db);
    db.close();
    const detail = relinked ? `relinked from ${relinked.from} (schema ${version})` : !existed ? `created in ${dbPath(dir)} (schema ${version})` : applied.length ? `migrated to schema ${version}` : `schema ${version}`;
    return { db: { version, latest: LATEST, applied, path: dbPath(dir), relinked }, check: { id: 'db', ok: true, label, detail } };
  } catch (err) {
    return fail(err.message);
  }
}

// Asks which of the candidates to relink: yes or no for one, a number for several.
async function askChoice(found) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (found.length === 1) {
      const answer = await rl.question(`\nThe project database is missing. ${describeStore(found[0])}, ${storeSummary(found[0])}, belongs to this repository and its folder no longer holds the project. Relink it? [y/N] `);
      return /^(y|yes)$/i.test(answer.trim()) ? found[0] : null;
    }
    console.log('\nThe project database is missing. These databases belong to this repository, and their folders no longer hold the project:');
    found.forEach((s, i) => console.log(`  ${i + 1}. ${describeStore(s)}, ${storeSummary(s)}`));
    const n = Number((await rl.question('Relink which one? (number, empty for none) ')).trim());
    return Number.isInteger(n) && n >= 1 && n <= found.length ? found[n - 1] : null;
  } finally {
    rl.close();
  }
}

// The databases whose project is gone (D93): reported, never deleted; `jerome forget` removes one after a backup.
// Those already offered for relinking in the check are left out.
function orphanWarning(offered) {
  let list;
  try {
    list = stores().filter((s) => s.orphan && !offered.some((o) => o.key === s.key));
  } catch {
    return null;
  }
  if (!list.length) return null;
  return {
    id: 'orphan-databases',
    databases: list.map((s) => ({ key: s.key, path: s.record?.path ?? null })),
    message: `${list.length === 1 ? 'A database belongs' : `${list.length} databases belong`} to a folder that no longer holds a Jérôme project: ${list.map((s) => `${describeStore(s)}, ${storeSummary(s)}`).join('; ')}. If the project moved, run \`jerome doctor\` in its new folder to relink it; if it is gone, \`jerome forget <key>\` removes the database after a backup.`,
  };
}

// Warnings about the project's own files, which need neither the setup nor Claude Code:
// a PROJECT.md still provisional (D35), agents without a declared model or loading CLAUDE.md (D41),
// a documentation queue over its limit (D43) and template files behind the installed version (D30),
// except in Jérôme's own repository, where the template is the source and not a copy.
export function projectWarnings(dir) {
  const warnings = [];
  const project = join(dir, STATE.project);
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
  let every = null;
  try {
    every = readMarker(dir).heartbeat?.every ?? null;
  } catch {
    // An unreadable project.json is reported elsewhere.
  }
  warnings.push(...areaWarnings(dir, { agents: projectAgents(dir).map((a) => a.meta.name || a.file.replace(/\.md$/, '')), every }));
  for (const message of projectLimitSettings(dir).problems) warnings.push({ id: 'limits-config', message });
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
    return { budgets, problems: ['.jerome/project.json: "budgets" must be an object such as { "PROJECT.md": 1200 }; the defaults apply.'] };
  }
  for (const [file, value] of Object.entries(custom)) {
    if (!(file in BUDGETS)) problems.push(`.jerome/project.json: no budget applies to ${file}; budgets exist for ${Object.keys(BUDGETS).join(' and ')}.`);
    else if (!Number.isInteger(value) || value <= 0) problems.push(`.jerome/project.json: the budget of ${file} must be a positive whole number of tokens; the default (${BUDGETS[file]}) applies.`);
    else budgets[file] = value;
  }
  return { budgets, problems };
}

export function checkBudgets(dir, context, budgets = BUDGETS) {
  const root = realpathSync(dir);
  const files = { [join(root, LEAD_FILE)]: 'jerome.md', [join(root, STATE.project)]: 'PROJECT.md' };
  return context.memoryFiles
    .filter((f) => f.path in files)
    .map((f) => ({ file: files[f.path], tokens: f.tokens, budget: budgets[files[f.path]] }))
    .filter((f) => f.tokens > f.budget);
}

// The instructions loaded into every session and heartbeat (D88): Jérôme's own, and the project's, such as a
// CLAUDE.md it had before adopting Jérôme. The project's are not Jérôme's to trim, but their cost is shown.
export function instructionFiles(dir, context) {
  const root = realpathSync(dir);
  const lead = join(root, LEAD_FILE);
  const project = join(root, STATE.project);
  const out = { jerome: [], project: [] };
  for (const f of context.memoryFiles) {
    if (!f.path.startsWith(`${root}/`)) continue;
    const rel = f.path.slice(root.length + 1);
    (f.path === lead || f.path === project ? out.jerome : out.project).push({ file: rel, tokens: f.tokens });
  }
  return out;
}

export function printReport(report) {
  for (const check of report.checks) {
    if (check.id === 'project') {
      if (!check.ok) console.error(check.detail);
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
      const ins = report.context.instructions;
      if (ins?.project.length) {
        const list = (l) => l.map((f) => `${f.file} ${f.tokens}`).join(' · ');
        console.log(`    instructions in every session and heartbeat: Jérôme's ${list(ins.jerome)}; the project's own ${list(ins.project)} tokens`);
      }
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
export async function ensureLeanProfile(dir, { fix = true } = {}) {
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

  // Plugins the project enables in its own settings.json stay on (D113): a false left here earlier is removed.
  const own = projectPlugins(dir);
  const installed = discoverInstalled();
  const applied = applyProfile(settings, desiredProfile({ ...installed, plugins: installed.plugins.filter((id) => !own.includes(id)) }));
  for (const id of own) {
    if (applied.settings.enabledPlugins?.[id] === false) {
      delete applied.settings.enabledPlugins[id];
      applied.changes.push(`enabledPlugins.${id}: left on, the project enables it`);
    }
  }
  if (fix && applied.changes.length) writeSettings(dir, applied.settings);
  settings = applied.settings;
  changes.push(...applied.changes);

  const hasProjectMcp = existsSync(join(dir, '.mcp.json'));
  // /context takes a few seconds: a progress line shows it is running (D79).
  const progress = startProgress('reading what Claude Code loads (/context)');
  try {
    let context = await inspectContext(dir);
    let leaks = findLeaks(context, { hasProjectMcp, plugins: own });

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
        progress.update('checking again after turning skills off');
        context = await inspectContext(dir);
        leaks = findLeaks(context, { hasProjectMcp, plugins: own });
      }
    }
    return { changes, context, leaks, plugins: own };
  } catch (error) {
    return { changes, error };
  } finally {
    progress.stop();
  }
}

// The machine's watchdog (D134) and Telegram bridge (D130): a token file others can read, a bridge nobody runs, and
// heartbeats whose missed starts nobody watches.
function watchdogWarnings(dir) {
  const warnings = [];
  const watched = existsSync(join(launchAgentsDir(), `${WATCHDOG_LABEL}.plist`));
  if (readTelegram()) {
    if ((statSync(telegramConfigPath()).mode & 0o077) !== 0) warnings.push(`${telegramConfigPath()} holds the Telegram token and others can read it: chmod 600 it.`);
    if (!watched) warnings.push('Telegram is set up but the watchdog that runs the bridge is not installed: run `jerome watchdog install`.');
  } else if (!watched && launchd.installed(dir).length && process.platform === 'darwin') {
    warnings.push('Nothing watches for heartbeats that do not start, nor closes runs whose process died: run `jerome watchdog install` (once per machine).');
  }
  return warnings;
}
