// What the latest session of a project really sent (D81), read from its transcript at zero cost: the context of its
// first call, and the tools and built-in agents Claude Code included. `/context` cannot tell either: run with -p it
// counts the headless tool set, and it lists no tool names. The latest session of any kind is used, interactive
// or heartbeat, so the figure stays fresh without sessions being opened.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { claudeConfigDir } from './claude.js';
import { CONTEXT_DENY_RULES } from './limits.js';

// The tools a Jérôme project expects in a request after its deny rules. Another tool with a definition over
// UNEXPECTED_CHARS is reported: it may be a denied tool renamed, or a new one paid on every call.
export const EXPECTED_TOOLS = ['Agent', 'Bash', 'Edit', 'Read', 'Write', 'Skill', 'ToolSearch', 'DeferredToolPlaceholder', 'advisor',
  'Grep', 'Glob', 'NotebookEdit', 'WebFetch', 'WebSearch', 'TodoWrite'];
export const UNEXPECTED_CHARS = 2000;

const DENIED_TOOLS = CONTEXT_DENY_RULES.filter((r) => !r.includes('('));
const DENIED_AGENTS = CONTEXT_DENY_RULES.map((r) => r.match(/^Agent\((.+)\)$/)?.[1]).filter(Boolean);

// Claude Code's transcript folder for a project: its path with every other character turned into "-".
export function transcriptFolder(dir) {
  return join(claudeConfigDir(), 'projects', realpathSync(dir).replace(/[^A-Za-z0-9]/g, '-'));
}

// The latest transcript with at least one call: its session id, the first call's context and time, and, when the
// transcript recorded the request (`api-request-shape`), the tools sent and the agents listed.
export function latestSession(dir) {
  const folder = transcriptFolder(dir);
  if (!existsSync(folder)) return null;
  const files = readdirSync(folder).filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, t: statSync(join(folder, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const { f } of files) {
    const session = readSession(join(folder, f));
    if (session) return { sessionId: f.replace(/\.jsonl$/, ''), ...session };
  }
  return null;
}

function readSession(path) {
  let first = null;
  let tools = null;
  let agents = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'api-request-shape' && !tools && Array.isArray(e.shape?.tools)) {
      tools = e.shape.tools.map((t) => ({ name: t.name, chars: JSON.stringify(t).length }));
    } else if (e.type === 'attachment' && e.attachment?.type === 'agent_listing_delta' && !agents) {
      agents = [...JSON.stringify(e.rendered ?? e.attachment).matchAll(/\\n- ([\w-]+):/g)].map((m) => m[1]);
    } else if (e.type === 'assistant' && e.requestId && e.message?.usage && !first) {
      const u = e.message.usage;
      first = { tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), at: e.timestamp ?? null };
    }
    if (first && tools && agents) break;
  }
  return first ? { firstCall: first, tools, agents } : null;
}

// Denied tools or agents that were still sent, and unexpected large tools. Null when the session cannot say.
export function toolProblems(session) {
  if (!session?.tools) return null;
  const names = session.tools.map((t) => t.name);
  return {
    deniedSent: DENIED_TOOLS.filter((t) => names.includes(t)),
    deniedAgents: DENIED_AGENTS.filter((a) => (session.agents ?? []).includes(a)),
    unexpected: session.tools.filter((t) => !EXPECTED_TOOLS.includes(t.name) && !DENIED_TOOLS.includes(t.name) && t.chars > UNEXPECTED_CHARS),
  };
}
