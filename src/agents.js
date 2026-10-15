// The project's subagents in `.claude/agents/` (D41, D42) and the documentation queue (D25, D43).
// Agent files belong to the project: Jérôme reads them but never writes or updates them.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATE_DIR } from './template.js';

export const AGENTS_DIR = join('.claude', 'agents');
export const CATALOG_DIR = join(TEMPLATE_DIR, '.claude', 'skills', 'project-team', 'agents');
export const QUEUE = join('docs', '_pending.md');
export const QUEUE_LIMIT = 20;

const MODELS = ['opus', 'sonnet', 'haiku'];

// Reads an agent file: its front matter as flat `key: value` pairs, and its body (the agent's prompt).
export function readAgent(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*\n?/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*?)\s*$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, body: text.slice(m[0].length).trim() };
}

export function projectAgents(dir) {
  const folder = join(dir, AGENTS_DIR);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({ file: name, ...readAgent(join(folder, name)) }));
}

// Agents that load CLAUDE.md, or whose model is not declared: the cost of each call is then left to chance.
export function agentWarnings(dir) {
  const warnings = [];
  for (const agent of projectAgents(dir)) {
    const problems = [];
    const model = agent.meta.model;
    if (!model || model === 'inherit') problems.push('no model declared');
    else if (!MODELS.includes(model) && !model.startsWith('claude-')) problems.push(`unknown model "${model}"`);
    if (agent.meta.omitClaudeMd !== 'true') problems.push('omitClaudeMd is not true, so every call loads CLAUDE.md and PROJECT.md');
    if (!problems.length) continue;
    warnings.push({
      id: 'agents',
      file: `${AGENTS_DIR}/${agent.file}`,
      problems,
      message: `${AGENTS_DIR}/${agent.file}: ${problems.join('; ')}. Ask the lead agent to fix it with the project-team skill.`,
    });
  }
  return warnings;
}

// The entries waiting in the documentation queue: one line each, starting with "- ".
export function queueEntries(dir) {
  const path = join(dir, QUEUE);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((line) => line.startsWith('- '));
}

export function queueWarning(dir) {
  const lines = queueEntries(dir).length;
  if (lines <= QUEUE_LIMIT) return null;
  return {
    id: 'docs-queue',
    lines,
    message: `${QUEUE} holds ${lines} entries, over ${QUEUE_LIMIT}: run \`/docs\` in a session or \`jerome docs\` to bring them into the documentation.`,
  };
}

// The documentarist used by `jerome docs`: the project's own, if it has one (it may have a different model),
// otherwise the catalog's.
export function documentarist(dir) {
  const own = join(dir, AGENTS_DIR, 'documentarist.md');
  const path = existsSync(own) ? own : join(CATALOG_DIR, 'documentarist.md');
  return { path, own: path === own, ...readAgent(path) };
}
