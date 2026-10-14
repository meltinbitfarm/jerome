import { existsSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { setupChecks, printChecks } from './checks.js';
import {
  discoverInstalled, desiredProfile, applyProfile, readSettings, writeSettings, settingsPath,
  splitProfileKeys, ensureGitignored, inspectContext, findLeaks, overrideFor, SHARED_SETTINGS, LOCAL_SETTINGS,
} from './profile.js';

export async function doctor(dirArg) {
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, '.jerome'))) {
    console.error(`${dir} is not a Jérôme project (the .jerome marker is missing).`);
    return 1;
  }
  if (!printChecks(setupChecks())) return 1;
  const result = ensureLeanProfile(dir);
  const ok = reportProfile(result);
  reportBudgets(checkBudgets(dir, result.context));
  return ok ? 0 : 1;
}

// Token budgets for the files loaded into every session (phase 2). Going over them only warns.
export const BUDGETS = { 'CLAUDE.md': 600, 'PROJECT.md': 800 };

export function checkBudgets(dir, context) {
  const root = realpathSync(dir);
  return context.memoryFiles
    .filter((f) => f.type === 'Project' && dirname(f.path) === root && basename(f.path) in BUDGETS)
    .map((f) => ({ file: basename(f.path), tokens: f.tokens, budget: BUDGETS[basename(f.path)] }))
    .filter((f) => f.tokens > f.budget);
}

export function reportBudgets(overBudget) {
  for (const f of overBudget) {
    console.log(`! ${f.file}: ${f.tokens} tokens, over its ${f.budget}-token budget. It is loaded into every session: keep it short.`);
  }
}

// Brings the project to the lean profile, in the git-ignored local settings, and checks with `/context`
// that it holds. A skill missed by the known sources (e.g. a personal skill) is turned off and the check runs once more.
export function ensureLeanProfile(dir) {
  const changes = [];
  if (ensureGitignored(dir)) changes.push(`.gitignore: added .claude/${LOCAL_SETTINGS}`);

  let settings = readSettings(dir);
  const split = splitProfileKeys(readSettings(dir, SHARED_SETTINGS));
  if (split.moved.length) {
    settings = applyProfile(settings, split.profile).settings;
    writeSettings(dir, settings);
    if (Object.keys(split.shared).length) writeSettings(dir, split.shared, SHARED_SETTINGS);
    else rmSync(settingsPath(dir, SHARED_SETTINGS));
    changes.push(`moved ${split.moved.length} profile entries from ${SHARED_SETTINGS} to ${LOCAL_SETTINGS}`);
  }

  const applied = applyProfile(settings, desiredProfile(discoverInstalled()));
  if (applied.changes.length) writeSettings(dir, applied.settings);
  settings = applied.settings;
  changes.push(...applied.changes);

  const hasProjectMcp = existsSync(join(dir, '.mcp.json'));
  let context = inspectContext(dir);
  let leaks = findLeaks(context, { hasProjectMcp });

  const extra = {};
  for (const skill of leaks.skills) {
    const name = overrideFor(skill);
    if (name && settings.skillOverrides?.[name] !== 'off') extra[name] = 'off';
  }
  if (Object.keys(extra).length) {
    const patched = applyProfile(settings, { skillOverrides: extra });
    writeSettings(dir, patched.settings);
    changes.push(...patched.changes);
    context = inspectContext(dir);
    leaks = findLeaks(context, { hasProjectMcp });
  }
  return { changes, context, leaks };
}

export function reportProfile({ changes, context, leaks }) {
  console.log(changes.length
    ? `✓ Lean profile updated (${changes.length} ${changes.length === 1 ? 'change' : 'changes'}):\n${changes.map((c) => `    ${c}`).join('\n')}`
    : '✓ Lean profile already in place');

  const ok = leaks.skills.length === 0 && leaks.mcp.length === 0;
  const projectSkills = context.skills.filter((s) => s.source === 'Project').map((s) => s.name);
  console.log(`${ok ? '✓' : '✗'} Startup context: ${context.total ?? '?'} estimated tokens, project skills: ${projectSkills.join(', ') || 'none'}`);
  for (const s of leaks.skills) console.log(`    ✗ skill still loaded: ${s.name} (${s.source})`);
  for (const c of leaks.mcp) console.log(`    ✗ ${c.name}: ${c.tokens} tokens, without a project .mcp.json`);
  return ok;
}
