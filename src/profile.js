// Lean project profile (D21): turns off plugins, claude.ai connectors, bundled skills and synced skills,
// so every session starts with the bare minimum. Only the project's own skills stay on.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude, claudeConfigDir } from './claude.js';

// Prefix under which Claude Code exposes skills synced from claude.ai. The qualified name is required:
// the plain one would also turn off the project skill with the same name (project-brief, D14).
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

// Merges the profile (possibly partial) into the existing settings, touching only Jérôme's keys.
// Returns the new settings and a readable list of the changes.
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

// Moves the entries that turn something off (the shape of Jérôme's keys) out of shared settings.
// Used to migrate projects created when the profile still lived in settings.json.
export function splitProfileKeys(settings) {
  const shared = structuredClone(settings);
  const profile = {};
  const moved = [];
  for (const key of ['disableClaudeAiConnectors', 'disableBundledSkills']) {
    if (shared[key] === true) {
      profile[key] = true;
      delete shared[key];
      moved.push(key);
    }
  }
  for (const [key, off] of [['enabledPlugins', false], ['skillOverrides', 'off']]) {
    for (const [name, value] of Object.entries(shared[key] ?? {})) {
      if (value !== off) continue;
      profile[key] ??= {};
      profile[key][name] = value;
      delete shared[key][name];
      moved.push(`${key}.${name}`);
    }
    if (shared[key] && Object.keys(shared[key]).length === 0) delete shared[key];
  }
  return { shared, profile, moved };
}

// The lean profile names the plugins and skills installed on this machine, so it lives in the
// git-ignored local settings (D21). Machine-independent settings stay in settings.json.
export const LOCAL_SETTINGS = 'settings.local.json';
export const SHARED_SETTINGS = 'settings.json';

export function settingsPath(dir, file = LOCAL_SETTINGS) {
  return join(dir, '.claude', file);
}

export function readSettings(dir, file = LOCAL_SETTINGS) {
  const path = settingsPath(dir, file);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err.message}`);
  }
}

export function writeSettings(dir, settings, file = LOCAL_SETTINGS) {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(settingsPath(dir, file), JSON.stringify(settings, null, 2) + '\n');
}

// Makes sure the local settings never end up in git. Returns true if .gitignore was changed.
export function ensureGitignored(dir) {
  const entry = `.claude/${LOCAL_SETTINGS}`;
  const path = join(dir, '.gitignore');
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (current.split('\n').some((line) => line.trim() === entry)) return false;
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  writeFileSync(path, `${current}${prefix}${entry}\n`);
  return true;
}

// What Claude Code actually loads in that folder, according to `/context`.
// It is a local command: it makes no API call and, without persistence, leaves no transcript.
export function inspectContext(dir) {
  const out = runClaude(['-p', '/context', '--no-session-persistence'], { cwd: dir, timeout: 120_000 });
  return parseContext(out);
}

export function parseContext(text) {
  if (!text.includes('## Context Usage')) {
    throw new Error('unrecognized `/context` output: the Claude Code format may have changed.');
  }
  const categories = [];
  const skills = [];
  const memoryFiles = [];
  let section = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('### ')) section = line.slice(4).trim();
    if (!line.startsWith('| ') || /^\|\s*-/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (section === 'Estimated usage by category' && cells[0] !== 'Category') {
      categories.push({ name: cells[0], tokens: cells[1] });
    } else if (section === 'Skills' && cells[0] !== 'Skill') {
      skills.push({ name: cells[0], source: cells[1], tokens: cells[2] });
    } else if (section === 'Memory Files' && cells[0] !== 'Type') {
      memoryFiles.push({ type: cells[0], path: cells[1], tokens: parseTokens(cells[2]) });
    }
  }
  const total = text.match(/\*\*Tokens:\*\*\s*([^\s/]+)/)?.[1] ?? null;
  return { total, categories, skills, memoryFiles };
}

// "481" → 481, "1.1k" → 1100, "~200" → 200.
export function parseTokens(value) {
  const m = String(value).match(/([\d.]+)\s*(k)?/i);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] ? 1000 : 1));
}

// What the lean profile should not let through. MCP tools are allowed only if the project has a .mcp.json.
export function findLeaks(context, { hasProjectMcp }) {
  const skills = context.skills.filter((s) => s.source !== 'Project');
  const mcp = hasProjectMcp ? [] : context.categories.filter((c) => c.name.startsWith('MCP tools'));
  return { skills, mcp };
}

// Override for a skill that slipped past the profile. Plugin skills are not turned off here but through enabledPlugins.
export function overrideFor(skill) {
  if (skill.source.startsWith('Plugin')) return null;
  if (skill.source === 'claude.ai sync') {
    return skill.name.startsWith(SYNCED_PREFIX) ? skill.name : SYNCED_PREFIX + skill.name;
  }
  return skill.name;
}
