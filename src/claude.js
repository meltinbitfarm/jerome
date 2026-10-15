import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Runs the Claude Code CLI and returns stdout; throws an error with the reason if it fails.
// With stdoutOnFailure it returns stdout anyway (e.g. `auth status` exits with 1 when logged out but still prints the JSON).
export function runClaude(args, { cwd, timeout = 60_000, stdoutOnFailure = false, env } = {}) {
  try {
    return execFileSync('claude', args, { cwd, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : undefined });
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('Claude Code is not installed (`claude` command not found).');
    if (stdoutOnFailure && err.stdout) return err.stdout.toString();
    const detail = (err.stderr || err.stdout || err.message).toString().trim().split('\n')[0];
    throw new Error(`\`claude ${args.join(' ')}\` failed: ${detail}`);
  }
}

export function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}
