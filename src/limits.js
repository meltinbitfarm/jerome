// The default agent limits made binding (D46): permission rules that deny the commands which send, publish,
// deploy or merge, in the project's versioned `.claude/settings.json`. Claude Code applies deny rules to the
// main session and to every subagent, in interactive and headless sessions, even when permissions are bypassed.
// They are a safety net for the common commands, not a sandbox: anything not listed here still relies on the
// written limits. The user can always run a denied command with `!` in a session or in a terminal.
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

// The deny rules missing from the project's settings.json. Throws if the file is not valid JSON.
export function missingDenyRules(dir) {
  const deny = readSettings(dir, SHARED_SETTINGS).permissions?.deny;
  const present = new Set(Array.isArray(deny) ? deny : []);
  return DENY_RULES.filter((rule) => !present.has(rule));
}

// Adds the missing deny rules to settings.json, keeping every other setting and rule. Returns the rules added.
export function addDenyRules(dir) {
  const missing = missingDenyRules(dir);
  if (!missing.length) return missing;
  const settings = readSettings(dir, SHARED_SETTINGS);
  settings.permissions ??= {};
  const deny = Array.isArray(settings.permissions.deny) ? settings.permissions.deny : [];
  settings.permissions.deny = [...deny, ...missing];
  writeSettings(dir, settings, SHARED_SETTINGS);
  return missing;
}
