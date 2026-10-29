// A heartbeat's whole usage while it runs (D109): the session's transcripts, the lead agent's and its subagents',
// read as they grow, the same files the hooks read. The stream alone did not always carry the subagents' usage:
// a run went past its cap unseen.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findTranscript } from './delegations.js';
import { parseCall } from './usage.js';

// What a call weighs against a run's token cap (D185): the context read again from the cache at every turn counts a
// tenth, as it is billed, and everything else whole. Counted whole, the same context read again turn after turn
// stopped runs after a dozen turns that had done little.
export const CACHE_READ_WEIGHT = 0.1;
export function capTokens(c) {
  return Math.round((c.input ?? 0) + (c.output ?? 0) + (c.cache_write_5m ?? 0) + (c.cache_write_1h ?? 0) + CACHE_READ_WEIGHT * (c.cache_read ?? 0));
}

// read() returns { total, byAgent }, each call counted once by request id, with its largest usage.
export function transcriptMeter(sessionId, { find = findTranscript } = {}) {
  const files = new Map();
  const calls = new Map();
  let main = null;

  const readNew = (path, file) => {
    const size = statSync(path).size;
    if (size <= file.offset) return;
    const buffer = Buffer.alloc(size - file.offset);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, buffer, 0, buffer.length, file.offset);
    } finally {
      closeSync(fd);
    }
    // Only complete lines: a line still being written is left for the next read.
    const end = buffer.lastIndexOf(0x0a);
    if (end === -1) return;
    for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) {
      const c = parseCall(line);
      if (!c) continue;
      const tokens = capTokens(c);
      const seen = calls.get(c.requestId);
      if (!seen || tokens > seen.tokens) calls.set(c.requestId, { path, tokens });
    }
    file.offset += end + 1;
  };

  return {
    read() {
      main ??= find(sessionId);
      if (!main) return { total: 0, byAgent: {} };
      if (!files.has(main)) files.set(main, { offset: 0, agent: 'main' });
      const folder = join(main.replace(/\.jsonl$/, ''), 'subagents');
      if (existsSync(folder)) {
        for (const name of readdirSync(folder).filter((f) => f.endsWith('.jsonl'))) {
          if (!files.has(join(folder, name))) files.set(join(folder, name), { offset: 0, agent: null });
        }
      }
      for (const [path, file] of files) {
        try {
          // A subagent's meta file may come after its first lines: its type is looked for until found.
          file.agent ??= agentType(path);
          readNew(path, file);
        } catch {
          // A file being rotated or removed is read again next time.
        }
      }
      const byAgent = {};
      let total = 0;
      for (const { path, tokens } of calls.values()) {
        const agent = files.get(path)?.agent ?? 'subagent';
        byAgent[agent] = (byAgent[agent] ?? 0) + tokens;
        total += tokens;
      }
      return { total, byAgent };
    },
  };
}

function agentType(path) {
  const meta = path.replace(/\.jsonl$/, '.meta.json');
  if (!existsSync(meta)) return null;
  try {
    return JSON.parse(readFileSync(meta, 'utf8')).agentType ?? 'subagent';
  } catch {
    return null;
  }
}
