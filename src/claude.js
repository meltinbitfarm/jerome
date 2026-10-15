import { execFileSync, spawn } from 'node:child_process';
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

// The same as runClaude, without blocking: a progress line can move while Claude Code works. onLine receives each
// line of standard output as it arrives, for streams.
export function runClaudeAsync(args, { cwd, timeout = 60_000, env, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : undefined });
    let stdout = '';
    let stderr = '';
    let pending = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!onLine) return;
      pending += chunk;
      const parts = pending.split('\n');
      pending = parts.pop();
      for (const line of parts) onLine(line);
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? new Error('Claude Code is not installed (`claude` command not found).') : err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (onLine && pending) onLine(pending);
      if (code === 0) return resolve(stdout);
      const detail = signal ? `stopped after ${timeout} ms` : (stderr || stdout).trim().split('\n')[0];
      reject(new Error(`\`claude ${args.join(' ')}\` failed: ${detail}`));
    });
  });
}
