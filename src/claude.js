import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Esegue la CLI di Claude Code e restituisce stdout; lancia un errore con il motivo se fallisce.
// Con stdoutOnFailure restituisce comunque lo stdout (es. `auth status` esce con 1 senza login ma stampa il JSON).
export function runClaude(args, { cwd, timeout = 60_000, stdoutOnFailure = false } = {}) {
  try {
    return execFileSync('claude', args, { cwd, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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
