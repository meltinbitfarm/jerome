// Profilo snello di progetto (D21): spegne plugin, connettori claude.ai, skill integrate e skill sincronizzate,
// così ogni sessione parte con il minimo indispensabile. Restano attive solo le skill del progetto.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude, claudeConfigDir } from './claude.js';

// Prefisso con cui Claude Code espone le skill sincronizzate da claude.ai. Serve il nome qualificato:
// quello semplice spegnerebbe anche la skill di progetto con lo stesso nome (project-brief, D14).
const SYNCED_PREFIX = 'anthropic-skills:';

export function discoverInstalled() {
  const plugins = JSON.parse(runClaude(['plugin', 'list', '--json'])).map((p) => p.id);
  const syncedRoot = join(claudeConfigDir(), 'skills', 'synced');
  const syncedSkills = [];
  if (existsSync(syncedRoot)) {
    for (const account of readdirSync(syncedRoot, { withFileTypes: true })) {
      if (!account.isDirectory() || account.name.startsWith('.')) continue;
      for (const skill of readdirSync(join(syncedRoot, account.name), { withFileTypes: true })) {
        if (skill.isDirectory() && existsSync(join(syncedRoot, account.name, skill.name, 'SKILL.md'))) {
          syncedSkills.push(skill.name);
        }
      }
    }
  }
  return { plugins: [...new Set(plugins)].sort(), syncedSkills: [...new Set(syncedSkills)].sort() };
}

export function desiredProfile({ plugins, syncedSkills }) {
  return {
    enabledPlugins: Object.fromEntries(plugins.map((id) => [id, false])),
    disableClaudeAiConnectors: true,
    disableBundledSkills: true,
    skillOverrides: Object.fromEntries(syncedSkills.map((name) => [SYNCED_PREFIX + name, 'off'])),
  };
}

// Unisce il profilo (anche parziale) nelle impostazioni esistenti toccando solo le chiavi di Jérôme.
// Restituisce le nuove impostazioni e l'elenco leggibile delle modifiche.
export function applyProfile(settings, profile) {
  const next = structuredClone(settings);
  const changes = [];
  for (const key of ['disableClaudeAiConnectors', 'disableBundledSkills']) {
    if (key in profile && next[key] !== profile[key]) {
      next[key] = profile[key];
      changes.push(`${key} = ${profile[key]}`);
    }
  }
  for (const key of ['enabledPlugins', 'skillOverrides']) {
    for (const [name, value] of Object.entries(profile[key] ?? {})) {
      next[key] ??= {};
      if (next[key][name] !== value) {
        next[key][name] = value;
        changes.push(`${key}.${name} = ${JSON.stringify(value)}`);
      }
    }
  }
  return { settings: next, changes };
}

export function settingsPath(dir) {
  return join(dir, '.claude', 'settings.json');
}

export function readSettings(dir) {
  const path = settingsPath(dir);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`${path} non è JSON valido: ${err.message}`);
  }
}

export function writeSettings(dir, settings) {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(settingsPath(dir), JSON.stringify(settings, null, 2) + '\n');
}

// Quello che Claude Code carica davvero in quella cartella, secondo `/context`.
// È un comando locale: non chiama l'API e, senza persistenza, non lascia transcript.
export function inspectContext(dir) {
  const out = runClaude(['-p', '/context', '--no-session-persistence'], { cwd: dir, timeout: 120_000 });
  return parseContext(out);
}

export function parseContext(text) {
  if (!text.includes('## Context Usage')) {
    throw new Error('output di `/context` non riconosciuto: il formato di Claude Code potrebbe essere cambiato.');
  }
  const categories = [];
  const skills = [];
  let section = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('### ')) section = line.slice(4).trim();
    if (!line.startsWith('| ') || /^\|\s*-/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (section === 'Estimated usage by category' && cells[0] !== 'Category') {
      categories.push({ name: cells[0], tokens: cells[1] });
    } else if (section === 'Skills' && cells[0] !== 'Skill') {
      skills.push({ name: cells[0], source: cells[1], tokens: cells[2] });
    }
  }
  const total = text.match(/\*\*Tokens:\*\*\s*([^\s/]+)/)?.[1] ?? null;
  return { total, categories, skills };
}

// Ciò che il profilo snello non dovrebbe lasciar passare. I tool MCP sono ammessi solo se il progetto ha un .mcp.json.
export function findLeaks(context, { hasProjectMcp }) {
  const skills = context.skills.filter((s) => s.source !== 'Project');
  const mcp = hasProjectMcp ? [] : context.categories.filter((c) => c.name.startsWith('MCP tools'));
  return { skills, mcp };
}

// Override per una skill sfuggita al profilo. Le skill dei plugin non si spengono qui ma con enabledPlugins.
export function overrideFor(skill) {
  if (skill.source.startsWith('Plugin')) return null;
  if (skill.source === 'claude.ai sync') {
    return skill.name.startsWith(SYNCED_PREFIX) ? skill.name : SYNCED_PREFIX + skill.name;
  }
  return skill.name;
}
