// Lean project profile (D21): turns off plugins, claude.ai connectors, bundled skills and synced skills,
// so every session starts with the bare minimum. Only the project's own skills stay on.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude, runClaudeAsync, claudeConfigDir } from './claude.js';

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

// Makes sure the local settings never end up in git. Returns true if .gitignore needed the entry;
// with write: false it only reports that, without touching the file.
export function ensureGitignored(dir, { write = true, entry = `.claude/${LOCAL_SETTINGS}` } = {}) {
  const path = join(dir, '.gitignore');
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (current.split('\n').some((line) => line.trim() === entry)) return false;
  if (write) {
    const prefix = current && !current.endsWith('\n') ? '\n' : '';
    writeFileSync(path, `${current}${prefix}${entry}\n`);
  }
  return true;
}

// What Claude Code actually loads in that folder, according to `/context`.
// It is a local command: it makes no API call and, without persistence, leaves no transcript.
export async function inspectContext(dir) {
  // The check is not a session of the project: its hooks must not record it as a run (D59).
  const out = await runClaudeAsync(['-p', '/context', '--no-session-persistence'], { cwd: dir, timeout: 120_000, env: { JEROME_HOOKS: 'off' } });
  return parseContext(out);
}

// The parts of `/context` that doctor depends on. If any of them is missing or different, the parse
// fails loudly: silently getting empty lists back would make doctor report a false pass.
export const CONTEXT_SECTIONS = {
  categories: { heading: 'Estimated usage by category', header: ['Category', 'Tokens', 'Percentage'] },
  skills: { heading: 'Skills', header: ['Skill', 'Source', 'Tokens'] },
  // Claude Code leaves this section out when the folder has no memory files (no CLAUDE.md): missing means empty.
  memoryFiles: { heading: 'Memory Files', header: ['Type', 'Path', 'Tokens'], optional: true },
};

// Skill source labels Claude Code uses in `/context` (2.1.x). Overrides depend on them, so an unknown one is an error.
const KNOWN_SOURCES = ['Project', 'User', 'Local', 'Flag', 'Managed', 'Built-in', 'MCP', 'Memory store', 'claude.ai sync'];

export function isKnownSource(source) {
  return KNOWN_SOURCES.includes(source) || /^Plugin \(.+\)$/.test(source);
}

export class ContextFormatError extends Error {
  constructor(problems, sections) {
    super(`unrecognized \`/context\` output, the Claude Code format may have changed: ${problems.join('; ')}`);
    this.problems = problems;
    this.sections = sections;
  }
}

// Splits the output into `### ` sections and reads the first table of each.
// A section whose heading is there but has no table counts as present and empty.
function readSections(text) {
  const sections = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('### ')) {
      current = { header: null, rows: [] };
      sections.set(line.slice(4).trim(), current);
    } else if (current && line.startsWith('|')) {
      if (/^\|[\s|:-]+\|?\s*$/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (!current.header) current.header = cells;
      else current.rows.push(cells);
    }
  }
  return sections;
}

export function parseContext(text) {
  const problems = [];
  if (!text.includes('## Context Usage')) problems.push('the "## Context Usage" heading is missing');
  const total = text.match(/\*\*Tokens:\*\*\s*([^\s/]+)/)?.[1] ?? null;
  if (total === null) problems.push('the "**Tokens:**" line is missing');

  const found = readSections(text);
  const rows = {};
  const sections = {};
  for (const [key, { heading, header, optional }] of Object.entries(CONTEXT_SECTIONS)) {
    const section = found.get(heading);
    // An optional section may be left out, but not renamed: another section with its table header is a rename.
    const renamed = !section && [...found.values()].some((s) => s.header?.join('|') === header.join('|'));
    if (!section && optional && !renamed) {
      sections[heading] = { found: false, rows: 0 };
      continue;
    }
    if (!section) {
      problems.push(`section "${heading}" is missing`);
      sections[heading] = { found: false, rows: 0 };
      continue;
    }
    if (section.header && section.header.join('|') !== header.join('|')) {
      problems.push(`section "${heading}" has table header "${section.header.join(' | ')}", expected "${header.join(' | ')}"`);
    }
    rows[key] = section.rows;
    sections[heading] = { found: true, rows: section.rows.length };
  }

  const categories = (rows.categories ?? []).map(([name, tokens]) => ({ name, tokens }));
  const skills = (rows.skills ?? []).map(([name, source, tokens]) => ({ name, source, tokens }));
  const memoryFiles = (rows.memoryFiles ?? []).map(([type, path, tokens]) => ({ type, path, tokens: parseTokens(tokens) }));

  if (sections[CONTEXT_SECTIONS.categories.heading].found && categories.length === 0) {
    problems.push(`section "${CONTEXT_SECTIONS.categories.heading}" is empty`);
  }
  // A Jérôme project always has at least the project-brief skill.
  if (sections[CONTEXT_SECTIONS.skills.heading].found && skills.length === 0) {
    problems.push(`section "${CONTEXT_SECTIONS.skills.heading}" is empty, but a Jérôme project always has project-brief`);
  }
  const unknown = [...new Set(skills.map((s) => s.source).filter((source) => !isKnownSource(source)))];
  if (unknown.length) problems.push(`unknown skill source label(s): ${unknown.map((u) => `"${u}"`).join(', ')}`);

  if (problems.length) throw new ContextFormatError(problems, sections);
  return { total, sections, categories, skills, memoryFiles };
}

// "481" → 481, "1.1k" → 1100, "~200" → 200.
export function parseTokens(value) {
  const m = String(value).match(/([\d.]+)\s*(k)?/i);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] ? 1000 : 1));
}

// What the lean profile should not let through. MCP tools are allowed only if the project has a .mcp.json.
// The plugins a project enables itself, with true in its versioned settings.json (D113): its own choice, left on.
export function projectPlugins(dir) {
  return Object.entries(readSettings(dir, SHARED_SETTINGS).enabledPlugins ?? {}).filter(([, on]) => on === true).map(([id]) => id);
}

// A skill of one of those plugins is the project's, not a leak: "Plugin (shop)" for shop@official.
export function isProjectPluginSkill(skill, plugins) {
  const m = skill.source.match(/^Plugin \((.+)\)$/);
  return Boolean(m) && plugins.some((id) => id.split('@')[0] === m[1]);
}

export function findLeaks(context, { hasProjectMcp, plugins = [] }) {
  const skills = context.skills.filter((s) => s.source !== 'Project' && !isProjectPluginSkill(s, plugins));
  const mcp = hasProjectMcp ? [] : context.categories.filter((c) => c.name.startsWith('MCP tools'));
  return { skills, mcp };
}

// Override for a skill that slipped past the profile. Plugin skills are turned off through enabledPlugins,
// and Managed (policy) skills cannot be turned off from a project.
export function overrideFor(skill) {
  if (skill.source.startsWith('Plugin') || skill.source === 'Managed') return null;
  if (skill.source === 'claude.ai sync') {
    return skill.name.startsWith(SYNCED_PREFIX) ? skill.name : SYNCED_PREFIX + skill.name;
  }
  return skill.name;
}
