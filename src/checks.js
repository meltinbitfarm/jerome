import { execFileSync } from 'node:child_process';
import { runClaude } from './claude.js';

// Setup checks (V3). Each returns { ok, label, detail }; they stop at the first failure that makes the next ones pointless.
export function setupChecks() {
  const results = [];
  const node = process.versions.node;
  results.push({ ok: Number(node.split('.')[0]) >= 24, label: 'Node ≥ 24', detail: node });

  try {
    const git = execFileSync('git', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    results.push({ ok: true, label: 'git installed', detail: git });
  } catch {
    results.push({ ok: false, label: 'git installed', detail: '`git` command not found.' });
  }

  let version;
  try {
    version = runClaude(['--version']).trim();
    results.push({ ok: true, label: 'Claude Code installed', detail: version });
  } catch (err) {
    results.push({ ok: false, label: 'Claude Code installed', detail: err.message });
    return results;
  }

  try {
    const status = JSON.parse(runClaude(['auth', 'status'], { stdoutOnFailure: true }));
    if (!status.loggedIn) {
      results.push({ ok: false, label: 'Logged in with a subscription', detail: 'not logged in: run `claude auth login`.' });
    } else if (status.authMethod !== 'claude.ai') {
      results.push({
        ok: false,
        label: 'Logged in with a subscription',
        detail: `logged in via "${status.authMethod}", not a claude.ai subscription (is ANTHROPIC_API_KEY set?).`,
      });
    } else {
      results.push({ ok: true, label: 'Logged in with a subscription', detail: status.email ?? '' });
    }
  } catch (err) {
    results.push({ ok: false, label: 'Logged in with a subscription', detail: err.message });
  }
  return results;
}

export function printChecks(results) {
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
  return results.every((r) => r.ok);
}
