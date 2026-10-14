import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setupChecks, printChecks } from './checks.js';
import {
  discoverInstalled, desiredProfile, applyProfile, readSettings, writeSettings,
  inspectContext, findLeaks, overrideFor,
} from './profile.js';

export async function doctor(dirArg) {
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, '.jerome'))) {
    console.error(`${dir} non è un progetto Jérôme (manca il marcatore .jerome).`);
    return 1;
  }
  if (!printChecks(setupChecks())) return 1;
  return reportProfile(ensureLeanProfile(dir)) ? 0 : 1;
}

// Porta il progetto al profilo snello e verifica con `/context` che regga.
// Una skill sfuggita alle fonti note (es. una skill personale) viene spenta e si riverifica una volta.
export function ensureLeanProfile(dir) {
  let settings = readSettings(dir);
  const { settings: next, changes } = applyProfile(settings, desiredProfile(discoverInstalled()));
  if (changes.length) writeSettings(dir, next);
  settings = next;

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
    ? `✓ Profilo snello aggiornato (${changes.length} ${changes.length === 1 ? 'modifica' : 'modifiche'}):\n${changes.map((c) => `    ${c}`).join('\n')}`
    : '✓ Profilo snello già in ordine');

  const ok = leaks.skills.length === 0 && leaks.mcp.length === 0;
  const projectSkills = context.skills.filter((s) => s.source === 'Project').map((s) => s.name);
  console.log(`${ok ? '✓' : '✗'} Contesto all'avvio: ${context.total ?? '?'} token stimati, skill di progetto: ${projectSkills.join(', ') || 'nessuna'}`);
  for (const s of leaks.skills) console.log(`    ✗ skill ancora caricata: ${s.name} (${s.source})`);
  for (const c of leaks.mcp) console.log(`    ✗ ${c.name}: ${c.tokens} token, senza un .mcp.json di progetto`);
  return ok;
}
