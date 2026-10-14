import { execFileSync } from 'node:child_process';
import { runClaude } from './claude.js';

// Verifiche di setup (V3). Ognuna restituisce { ok, label, detail }; si fermano alla prima che blocca le successive.
export function setupChecks() {
  const results = [];
  const node = process.versions.node;
  results.push({ ok: Number(node.split('.')[0]) >= 24, label: 'Node ≥ 24', detail: node });

  try {
    const git = execFileSync('git', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    results.push({ ok: true, label: 'git installato', detail: git });
  } catch {
    results.push({ ok: false, label: 'git installato', detail: 'comando `git` non trovato.' });
  }

  let version;
  try {
    version = runClaude(['--version']).trim();
    results.push({ ok: true, label: 'Claude Code installato', detail: version });
  } catch (err) {
    results.push({ ok: false, label: 'Claude Code installato', detail: err.message });
    return results;
  }

  try {
    const status = JSON.parse(runClaude(['auth', 'status'], { stdoutOnFailure: true }));
    if (!status.loggedIn) {
      results.push({ ok: false, label: 'Login con la subscription', detail: 'non hai fatto il login: lancia `claude auth login`.' });
    } else if (status.authMethod !== 'claude.ai') {
      results.push({
        ok: false,
        label: 'Login con la subscription',
        detail: `il login usa "${status.authMethod}", non la subscription claude.ai (c'è ANTHROPIC_API_KEY nell'ambiente?).`,
      });
    } else {
      results.push({ ok: true, label: 'Login con la subscription', detail: status.email ?? '' });
    }
  } catch (err) {
    results.push({ ok: false, label: 'Login con la subscription', detail: err.message });
  }
  return results;
}

export function printChecks(results) {
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
  return results.every((r) => r.ok);
}
