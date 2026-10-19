// The assumptions of open.md (D116): minor, reversible choices the lead agent made on its own, waiting for the user to
// confirm or correct them in one block. Read from the file at zero tokens; one line each, `- A3: choice — reason`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE } from './paths.js';

export function readAssumptions(dir) {
  let text;
  try {
    text = readFileSync(join(dir, STATE.open), 'utf8');
  } catch {
    return [];
  }
  const section = text.split(/^## /m).find((s) => /^Assumptions\s*\n/.test(s));
  if (!section) return [];
  return section.split('\n').map((l) => l.match(/^- (A\d+):\s*(.+)$/)).filter(Boolean).map((m) => ({ id: m[1], text: m[2].trim() }));
}
