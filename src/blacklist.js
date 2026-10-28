// What a heartbeat may not run (D159). A heartbeat runs any command on the machine, so the lead agent uses what is
// there (python3, node, the project's scripts) without asking; what stays refused is what cannot be undone or leaves
// the machine. Pushing, publishing, deploying and mail are deny rules in .claude/settings.json (D46), which Claude
// Code applies whatever the permissions; this is the rest, which a rule's pattern cannot express, checked by the
// PreToolUse hook: sudo, deleting outside the project, credentials, a download piped into a shell.
// It reads the whole command too, not only its segments, so `bash -c '…'` and $(…) are seen; a false refusal costs
// the agent one more try, said in the reason.
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { splitCommand } from './chain.js';

const HOME = String.raw`(?:~|\$HOME|\$\{HOME\}|/Users/[^/\s'"]+|/home/[^/\s'"]+)`;
const CREDENTIALS = new RegExp(`${HOME}/(?:\\.ssh|\\.aws|\\.gnupg|\\.netrc|\\.npmrc|\\.pypirc|\\.docker/config\\.json|\\.kube|\\.config/gh|\\.config/gcloud|\\.claude/\\.credentials|Library/Keychains)`);
const ROOT = /(^|[\s;&|(`'"])(sudo|doas)\s|(^|[;&|(`]\s*)su(\s|$)/;
const KEYCHAIN = /(^|[\s;&|(`'"])security\s+[a-z]/;
const PIPED = /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(sh|bash|zsh|dash|fish|python3?|node|perl|ruby)\b|\b(sh|bash|zsh)\s+(-c\s+)?["']?(\$\(|<\()\s*(curl|wget)\b/;
const REMOVE = /^(?:\w+=\S*\s+)*(?:command\s+)?(rm|rmdir|unlink)\s/;

// The real path, through links such as macOS's /var → /private/var, of a file that may not exist yet: its deepest
// existing folder resolved, the rest kept.
function real(p) {
  try {
    return realpathSync(p);
  } catch {
    const parent = dirname(p);
    return parent === p ? p : join(real(parent), basename(p));
  }
}
const inside = (path, dir) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`);

// Where a path a command names really is: ~ and $HOME expanded, relative to the command's folder. Null when it
// depends on another variable, which only the shell knows.
function where(arg, cwd) {
  let p = arg.replace(/^["']|["']$/g, '');
  p = p.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, homedir());
  if (p.includes('$') || p.includes('`')) return null;
  return resolve(isAbsolute(p) ? p : join(cwd, p));
}

// Where a heartbeat may delete: its project, and the temporary folders.
function deletable(path, dir) {
  const allowed = [dir, tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'].map(real);
  const target = real(path);
  return allowed.some((a) => inside(target, a) && target !== a);
}

// Null when the command may run in a heartbeat, or { reason } for the agent.
export function blacklisted(command, { dir, cwd = dir }) {
  const text = String(command ?? '');
  const refuse = (what) => ({ reason: `Refused in a heartbeat (Jérôme D159): ${what}. Do the task another way, inside the project; if it truly needs this, open a decision request for the user and go on with the rest.` });
  if (ROOT.test(text)) return refuse('sudo and su are never run without the user');
  if (KEYCHAIN.test(text)) return refuse('the Keychain (`security`) holds credentials');
  if (CREDENTIALS.test(text)) return refuse('that folder holds credentials (SSH, cloud, GitHub, package registries)');
  if (PIPED.test(text)) return refuse('a download piped into a shell runs code nobody has read; download the file, read it, then run it');
  const project = real(dir);
  for (const segment of splitCommand(text)) {
    if (REMOVE.test(segment)) {
      const args = segment.replace(REMOVE, '').split(/\s+/).filter((a) => a && !a.startsWith('-'));
      for (const arg of args) {
        const path = where(arg, cwd);
        if (path === null) return refuse(`\`${arg}\` depends on a variable, so where it deletes is unknown; write the path inside the project`);
        if (!deletable(path, project)) return refuse(`\`${arg}\` is outside the project's folder`);
      }
    }
    if (/^find\s/.test(segment) && /\s-delete\b|-exec\s+rm\b/.test(segment)) {
      const start = segment.split(/\s+/)[1];
      const path = start && !start.startsWith('-') ? where(start, cwd) : cwd;
      if (path === null || !deletable(path, project)) return refuse('find deletes outside the project\'s folder');
    }
    for (const env of segment.match(/(?:^|\s)(["']?[^\s'"]*\.env(?:\.[\w.-]+)?["']?)(?=\s|$)/g) ?? []) {
      const path = where(env.trim(), cwd);
      if (path !== null && !inside(real(path), project)) return refuse('an .env file outside the project holds another project\'s secrets');
    }
  }
  return null;
}
