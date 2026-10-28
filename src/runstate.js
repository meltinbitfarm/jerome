// The state of the repository around an autonomous run (D119, D120), read with git at zero tokens, and the small
// files a heartbeat keeps on this machine: its lock, the flag that sends the next run into RESUME mode, and the
// quota override of one day. Kept apart from heartbeat.js so the hooks can read the lock without loading it.
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { jobLabel } from './schedule.js';
import { STATE } from './paths.js';
import { MARKER, TEMPLATE_DIR } from './template.js';

export function cacheDir(...parts) {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'jerome', ...parts);
}

const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

// A lock file with the pid of the heartbeat holding it. A lock left by a process that no longer exists is taken over.
export function lockPath(dir) {
  return cacheDir('locks', `${jobLabel(dir)}.lock`);
}

export function acquireLock(dir) {
  const path = lockPath(dir);
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, String(process.pid), { flag: 'wx' });
      return path;
    } catch {
      if (lockHolder(dir)) return null;
      rmSync(path, { force: true });
    }
  }
  return null;
}

export function releaseLock(path) {
  if (path) rmSync(path, { force: true });
}

// The pid of the heartbeat running in this working tree, or null. The folder is tried as given and resolved, since
// Claude Code and launchd may name it differently (/tmp and /private/tmp).
export function lockHolder(dir) {
  const dirs = [dir];
  try {
    dirs.push(realpathSync(dir));
  } catch {
    // A folder that is gone holds no heartbeat.
  }
  for (const d of new Set(dirs)) {
    let pid;
    try {
      pid = Number(readFileSync(lockPath(d), 'utf8'));
    } catch {
      continue;
    }
    if (alive(pid)) return pid;
  }
  return null;
}

export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// The RESUME flag (D119): set when a run's end check fails, cleared when one passes. It survives the runner going
// back to main after a stopped run (D112), so the next run still knows the work is half done.
const resumePath = (dir) => cacheDir('heartbeat', `${jobLabel(dir)}.resume.json`);

export function readResume(dir) {
  try {
    return JSON.parse(readFileSync(resumePath(dir), 'utf8'));
  } catch {
    return null;
  }
}

export function writeResume(dir, data) {
  mkdirSync(dirname(resumePath(dir)), { recursive: true });
  writeFileSync(resumePath(dir), `${JSON.stringify(data)}\n`);
}

export function clearResume(dir) {
  rmSync(resumePath(dir), { force: true });
}

// The quota override (D124): for the local calendar day it was set on, the limits do not pause this project's runs.
const overridePath = (dir) => cacheDir('heartbeat', `${jobLabel(dir)}.override.json`);

export function localDay(now = new Date()) {
  const pad = (x) => String(x).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function setOverride(dir, now = new Date()) {
  mkdirSync(dirname(overridePath(dir)), { recursive: true });
  writeFileSync(overridePath(dir), `${JSON.stringify({ day: localDay(now), at: now.toISOString() })}\n`);
}

export function overrideToday(dir, now = new Date()) {
  try {
    return JSON.parse(readFileSync(overridePath(dir), 'utf8')).day === localDay(now);
  } catch {
    return false;
  }
}

export function currentBranch(dir) {
  const r = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  return r.status === 0 ? r.stdout.trim() : null;
}

export function hasCommit(dir) {
  return git(dir, 'rev-parse', '--verify', '-q', 'HEAD').status === 0;
}

// Tracked files changed in the working tree, except digest.md, which the lead agent appends to, and
// .jerome/project.json, which `jerome schedule` and `jerome update` change. Null without a commit.
export function uncommitted(dir) {
  if (!hasCommit(dir)) return null;
  const r = git(dir, 'status', '--porcelain', '--untracked-files=no');
  if (r.status !== 0) return null;
  return r.stdout.split('\n').filter(Boolean).map((l) => l.slice(3)).filter((f) => f !== STATE.digest && f !== MARKER);
}

// The lead agent's state files (D127): the Markdown files of .jerome/ and its notes. The project's settings and
// database are not among them.
export function isStateFile(file) {
  return file.startsWith('.jerome/') && (file.endsWith('.md') || file.startsWith('.jerome/notes/'));
}

// What Jérôme itself writes in a project (D158): the state files, its settings in project.json, the hooks and status
// line doctor keeps in .claude/settings.json, and a template file exactly as the installed Jérôme has it, which
// `jerome update` wrote. Left uncommitted, they are Jérôme's to commit, never a reason to stop.
export function isOwnFile(file, dir = null) {
  if (isStateFile(file) || file === '.jerome/project.json' || file === '.claude/settings.json') return true;
  if (!dir) return false;
  const template = join(TEMPLATE_DIR, file);
  try {
    return existsSync(template) && readFileSync(template).equals(readFileSync(join(dir, file)));
  } catch {
    return false;
  }
}

export const CARRY_MESSAGE = 'State: carried over from the interactive session';
export const OWN_MESSAGE = 'Jérôme: its own files, committed by the runner';

// Uncommitted changes on main limited to Jérôme's own files (D127, D158) are its bookkeeping, not work in progress:
// the run commits them, by their paths, and starts. Null when there is nothing of the kind to carry (changes to
// anything else still stop the run, in startState); { files } once committed; { files, error }.
export function carryState(dir, config, resume = readResume(dir), message = CARRY_MESSAGE) {
  if (resume || operationInProgress(dir) || currentBranch(dir) !== config.mainBranch) return null;
  const files = uncommitted(dir) ?? [];
  if (!files.length || !files.every((f) => isOwnFile(f, dir) && !f.includes(' -> '))) return null;
  const r = git(dir, 'commit', '-q', '-m', message, '--', ...files);
  return r.status === 0 ? { files } : { files, error: (r.stderr || r.stdout).trim().split('\n').pop() || `git commit exited with ${r.status}` };
}

// A merge, rebase, cherry-pick or revert left in progress, from the files git keeps while one is.
export function operationInProgress(dir) {
  const r = git(dir, 'rev-parse', '--absolute-git-dir');
  if (r.status !== 0) return null;
  const found = [['MERGE_HEAD', 'merge'], ['rebase-merge', 'rebase'], ['rebase-apply', 'rebase'], ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert']]
    .find(([file]) => existsSync(join(r.stdout.trim(), file)));
  return found?.[1] ?? null;
}

export function branchPattern(pattern) {
  return new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

// Work branches with commits that main does not have: half-done work, whoever left it.
export function unmergedWorkBranches(dir, { mainBranch, workBranch }) {
  const r = git(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/');
  if (r.status !== 0) return [];
  const re = branchPattern(workBranch);
  return r.stdout.split('\n').filter((b) => b && re.test(b)).filter((b) => {
    const ahead = git(dir, 'rev-list', '--count', `${mainBranch}..${b}`);
    return ahead.status === 0 && Number(ahead.stdout.trim()) > 0;
  });
}

// Where a run starts from (D119): main and clean is a normal run; what a heartbeat left half done (a work branch,
// a dirty tree or an operation after a failed end check, an unmerged work branch) is a RESUME run; anything else
// is the user's or unknown, and is skipped with an alert, never touched.
export function startState(dir, config, resume = readResume(dir)) {
  if (!hasCommit(dir)) return { mode: 'skip', reason: 'not a git repository with a commit yet' };
  const branch = currentBranch(dir);
  const dirty = uncommitted(dir) ?? [];
  const files = `${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? ', …' : ''}`;
  const op = operationInProgress(dir);
  const left = resume ? ` (left by the heartbeat of ${resume.since?.slice(0, 16).replace('T', ' ') ?? 'an earlier run'}: ${resume.reason})` : '';
  if (op) {
    return resume
      ? { mode: 'resume', why: `a ${op} in progress on ${branch}${left}` }
      : { mode: 'skip', alert: true, reason: `a ${op} in progress on ${branch}, not left by a heartbeat: finish or abort it` };
  }
  if (branch === 'HEAD') {
    return resume ? { mode: 'resume', why: `a detached HEAD${left}` } : { mode: 'skip', alert: true, reason: 'detached HEAD, not left by a heartbeat: switch back to a branch' };
  }
  if (branchPattern(config.workBranch).test(branch)) {
    return { mode: 'resume', why: `the work branch ${branch}${dirty.length ? ` with uncommitted changes (${files})` : ''}${left}` };
  }
  // A branch the last run left, even one not named like a work branch, is that run's.
  if (branch !== config.mainBranch && resume?.branch === branch) {
    return { mode: 'resume', why: `the branch ${branch}${dirty.length ? ` with uncommitted changes (${files})` : ''}${left}` };
  }
  if (branch !== config.mainBranch) {
    return { mode: 'skip', alert: true, reason: `on branch ${branch}, neither ${config.mainBranch} nor a work branch (${config.workBranch}): switch back to ${config.mainBranch}` };
  }
  if (dirty.length) {
    return resume
      ? { mode: 'resume', why: `uncommitted changes on ${branch} (${files})${left}` }
      : { mode: 'skip', alert: true, reason: `uncommitted changes (${files}) on ${branch}, not left by a heartbeat: commit or discard them` };
  }
  const unmerged = unmergedWorkBranches(dir, config);
  if (resume || unmerged.length) {
    return { mode: 'resume', why: `${unmerged.length ? `unmerged work ${unmerged.length === 1 ? 'branch' : 'branches'} ${unmerged.join(', ')}` : 'work left half done'}${left}` };
  }
  return { mode: 'normal' };
}

export function digestLines(dir) {
  const path = join(dir, STATE.digest);
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((l) => l.startsWith('- ')).length : 0;
}

// The end-of-run check (D120), after every run of the lead agent: back on main, tracked tree clean, no operation in
// progress, its line added to the digest, exit 0 within the max duration. With an interactive session working
// alongside (D122), changes to the state files only are that session's, and noted rather than failed.
export function endCheck(dir, config, { digestBefore, exitCode, timedOut, stopped = false, maxMinutes, interactive = false }) {
  const failures = [];
  const notes = [];
  if (timedOut) failures.push(`over the max duration of ${maxMinutes} min, process tree stopped`);
  // A run the runner stopped itself (a cap, an interrupt) has its reason already: its exit code says nothing more.
  else if (exitCode !== 0 && !stopped) failures.push(`claude exited with ${exitCode === null ? 'a signal' : `code ${exitCode}`}`);
  const op = operationInProgress(dir);
  if (op) failures.push(`a ${op} in progress`);
  const branch = currentBranch(dir);
  if (branch !== config.mainBranch) failures.push(`ended on ${branch === 'HEAD' ? 'a detached HEAD' : `branch ${branch}`}, not ${config.mainBranch}`);
  const dirty = uncommitted(dir) ?? [];
  const stateOnly = dirty.length && dirty.every(isStateFile);
  if (dirty.length && interactive && stateOnly) notes.push(`state files changed by the interactive session: ${dirty.join(', ')}`);
  else if (dirty.length) failures.push(`uncommitted changes (${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? ', …' : ''})`);
  if (digestLines(dir) <= digestBefore) failures.push('no line added to .jerome/digest.md');
  return { ok: !failures.length, failures, notes };
}
