// The default limits made binding (D46, D48): permission rules in the project's versioned `.claude/settings.json`.
// - deny: commands that send, publish, deploy or push. Claude Code applies deny rules to the main session and to
//   every subagent, in interactive and headless sessions, even when permissions are bypassed.
// - allow: the safe local operations a task needs (read the repo, commit on a branch, merge it, run the tests),
//   so auto mode never mistakes them for something else. Claude Code honours allow rules only in a folder the
//   user has trusted, and in auto mode it drops broad ones, which is why the test commands are exact.
// - ask: the forms of those allowed commands that discard work, which an allow rule would otherwise approve.
// Precedence is deny, then ask, then allow. The rules are a safety net for the common commands, not a sandbox.
// The user can always run a denied command with `!` in a session or in a terminal.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readSettings, writeSettings, SHARED_SETTINGS } from './profile.js';

export const DENY_RULES = [
  // Pushing: `git push` and `git -C <dir> push`, also inside compound commands (`cd x && git push`).
  'Bash(git push *)',
  'Bash(git -C * push *)',
  // Merging and releasing on GitHub.
  'Bash(gh pr merge *)',
  'Bash(gh release create *)',
  // Publishing packages and images.
  'Bash(npm publish *)',
  'Bash(pnpm publish *)',
  'Bash(yarn publish *)',
  'Bash(yarn npm publish *)',
  'Bash(bun publish *)',
  'Bash(cargo publish *)',
  'Bash(twine upload *)',
  'Bash(uv publish *)',
  'Bash(poetry publish *)',
  'Bash(gem push *)',
  'Bash(docker push *)',
  // Deploying.
  'Bash(vercel)',
  'Bash(vercel deploy *)',
  'Bash(vercel --prod *)',
  'Bash(netlify deploy *)',
  'Bash(firebase deploy *)',
  'Bash(fly deploy *)',
  'Bash(flyctl deploy *)',
  'Bash(wrangler deploy *)',
  'Bash(wrangler publish *)',
  'Bash(wrangler pages deploy *)',
  // Sending email.
  'Bash(sendmail *)',
  'Bash(mail *)',
  'Bash(mailx *)',
];

export const ALLOW_RULES = [
  // Reading the repository.
  'Bash(git status *)',
  'Bash(git log *)',
  'Bash(git diff *)',
  'Bash(git show *)',
  'Bash(git rev-parse *)',
  'Bash(git merge-base *)',
  'Bash(git stash list *)',
  // Working on a branch and merging it (D47).
  'Bash(git add *)',
  'Bash(git commit *)',
  'Bash(git switch *)',
  'Bash(git checkout *)',
  'Bash(git branch *)',
  'Bash(git merge *)',
  // Running the tests: exact commands, since auto mode drops wildcarded package-manager and interpreter rules.
  'Bash(npm test)',
  'Bash(pnpm test)',
  'Bash(yarn test)',
  'Bash(bun test)',
  'Bash(node --test)',
  'Bash(pytest)',
  'Bash(cargo test)',
  'Bash(go test ./...)',
];

export const ASK_RULES = [
  'Bash(git checkout -- *)',
  'Bash(git checkout * -- *)',
  'Bash(git checkout .)',
  'Bash(git checkout -f *)',
  'Bash(git switch -f *)',
  'Bash(git switch --discard-changes *)',
  'Bash(git branch -D *)',
  'Bash(git commit --amend *)',
];

export const RULES = { deny: DENY_RULES, ask: ASK_RULES, allow: ALLOW_RULES };
export const RULE_COUNT = DENY_RULES.length + ASK_RULES.length + ALLOW_RULES.length;

// The default rules missing from the project's settings.json, as { list, rule }. Throws if the file is not valid JSON.
export function missingRules(dir) {
  const permissions = readSettings(dir, SHARED_SETTINGS).permissions ?? {};
  const missing = [];
  for (const [list, rules] of Object.entries(RULES)) {
    const present = new Set(Array.isArray(permissions[list]) ? permissions[list] : []);
    for (const rule of rules) if (!present.has(rule)) missing.push({ list, rule });
  }
  return missing;
}

// Adds the missing rules to settings.json, after the project's own, keeping every other setting. Returns the rules added.
export function addRules(dir) {
  const missing = missingRules(dir);
  if (!missing.length) return missing;
  const settings = readSettings(dir, SHARED_SETTINGS);
  settings.permissions ??= {};
  for (const { list, rule } of missing) {
    if (!Array.isArray(settings.permissions[list])) settings.permissions[list] = [];
    settings.permissions[list].push(rule);
  }
  writeSettings(dir, settings, SHARED_SETTINGS);
  return missing;
}

// Whether the user has accepted Claude Code's trust dialog for this folder: until then, Claude Code ignores the
// allow rules of the project's settings.json (deny rules apply anyway). Returns null when it cannot tell.
export function isTrusted(dir) {
  const config = join(process.env.CLAUDE_CONFIG_DIR || homedir(), '.claude.json');
  if (!existsSync(config)) return null;
  try {
    const projects = JSON.parse(readFileSync(config, 'utf8')).projects ?? {};
    return projects[realpathSync(dir)]?.hasTrustDialogAccepted === true;
  } catch {
    return null;
  }
}
