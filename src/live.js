// The live view of a run (D115): the lead agent, its subagents, what each one does and the run's tokens against its
// cap, read from the session's transcripts and the database at zero tokens. Only what Jérôme measures: no progress,
// no estimate. Each transcript is read from where the last request stopped, in memory only, and a run nobody asks
// about for 5 minutes is forgotten. Nothing is written, nothing read here is stored.
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, dbPath } from './db.js';
import { findTranscript, toolHint } from './delegations.js';
import { parseCall } from './usage.js';

const LOG_LINES = 200;
const FORGET_MS = 5 * 60_000;
const readers = new Map();

export function liveRun(dir, id, { now = new Date(), find = findTranscript } = {}) {
  for (const [key, r] of readers) if (now.getTime() - r.askedAt > FORGET_MS) readers.delete(key);
  const db = openDb(dir, { readOnly: true, migrate: false });
  let run;
  let events;
  try {
    run = db.prepare('SELECT id, session_id, kind, status, started_at, ended_at, area, caps FROM runs WHERE id = ?').get(id);
    if (!run) return { error: 'no such run' };
    events = db.prepare("SELECT at, kind, agent, data FROM events WHERE run_id = ? AND kind IN ('blocked', 'error') ORDER BY id").all(id);
  } finally {
    db.close();
  }
  const key = `${dbPath(dir)}#${id}`;
  const reader = readers.get(key) ?? readers.set(key, newReader(run.session_id, run.started_at, find)).get(key);
  reader.askedAt = now.getTime();
  reader.update();
  return build(run, events, reader, now);
}

// Forgets every reader: for tests.
export function forgetReaders() {
  readers.clear();
}

function newReader(sessionId, since, find) {
  const r = {
    askedAt: 0,
    main: null,
    files: new Map(),
    calls: new Map(),
    toolUses: new Map(),
    results: new Map(),
    subs: new Map(),
    log: [],
  };
  r.update = () => {
    r.main ??= find(sessionId);
    if (!r.main) return;
    if (!r.files.has(r.main)) r.files.set(r.main, { offset: 0, sub: null });
    const folder = join(r.main.replace(/\.jsonl$/, ''), 'subagents');
    if (existsSync(folder)) {
      for (const name of readdirSync(folder).filter((f) => f.endsWith('.jsonl'))) {
        const path = join(folder, name);
        if (r.files.has(path)) continue;
        const agentId = name.replace(/^agent-/, '').replace(/\.jsonl$/, '');
        r.files.set(path, { offset: 0, sub: agentId });
        r.subs.set(agentId, { agentId, meta: null, metaPath: path.replace(/\.jsonl$/, '.meta.json'), model: null, firstAt: null, lastAt: null, handback: null });
      }
    }
    for (const [path, file] of r.files) {
      try {
        const sub = file.sub ? r.subs.get(file.sub) : null;
        // A subagent's meta file may come after its first lines: it is looked for until found.
        if (sub && !sub.meta && existsSync(sub.metaPath)) sub.meta = JSON.parse(readFileSync(sub.metaPath, 'utf8'));
        for (const line of newLines(path, file)) read(r, line, file.sub, since);
      } catch {
        // A file being written or rotated is read again next time.
      }
    }
  };
  return r;
}

// The complete lines added since the last read: a line still being written is left for the next one.
function newLines(path, file) {
  const size = statSync(path).size;
  if (size <= file.offset) return [];
  const buffer = Buffer.alloc(size - file.offset);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, buffer.length, file.offset);
  } finally {
    closeSync(fd);
  }
  const end = buffer.lastIndexOf(0x0a);
  if (end === -1) return [];
  file.offset += end + 1;
  return buffer.subarray(0, end).toString('utf8').split('\n').filter(Boolean);
}

function read(r, line, agentId, since) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  // A resumed session's transcript holds what came before the run: it is left out.
  if (!e.timestamp || e.timestamp < since) return;
  const at = new Date(e.timestamp).toISOString();
  const sub = agentId ? r.subs.get(agentId) : null;
  if (sub) {
    sub.firstAt ??= at;
    sub.lastAt = at;
  }
  const call = parseCall(line);
  if (call) {
    const tokens = call.input + call.output + call.cache_read + call.cache_write_5m + call.cache_write_1h;
    const seen = r.calls.get(call.requestId);
    const context = call.input + call.cache_read + call.cache_write_5m + call.cache_write_1h;
    if (!seen || tokens > seen.tokens) r.calls.set(call.requestId, { agentId, at: seen?.at ?? at, model: call.model, tokens, context, output: call.output });
    if (sub) sub.model = call.model;
  }
  const content = Array.isArray(e.message?.content) ? e.message.content : [];
  if (e.type === 'assistant') {
    for (const c of content) {
      if (c.type !== 'tool_use') continue;
      const input = c.input ?? {};
      if (!agentId && (c.name === 'Agent' || c.name === 'Task')) {
        r.toolUses.set(c.id, { at, input });
        r.log.push({ at, agentId, action: 'delegate', detail: `→ ${input.subagent_type ?? 'subagent'}: ${input.description ?? ''}`.trim() });
      } else if (c.name === 'SubagentHandback' && sub) {
        const words = wordCount(input.message);
        sub.handback = { at, words };
        r.log.push({ at, agentId, action: 'handback', detail: `${quote(input.message)} (${words} words)` });
      } else {
        r.log.push({ at, agentId, action: c.name, detail: toolHint(c.name, input) });
      }
    }
  } else if (e.type === 'user' && !agentId) {
    for (const c of content) {
      if (c.type === 'tool_result' && r.toolUses.has(c.tool_use_id)) r.results.set(c.tool_use_id, { at, words: wordCount(textOf(c.content)) });
    }
  }
}

function build(run, events, r, now) {
  const running = run.status === 'running';
  // Subagents, each linked to its Agent call; a call with no transcript yet is a subagent starting.
  const linked = new Set();
  const agents = [...r.subs.values()].map((s) => {
    const use = s.meta?.toolUseId ? r.toolUses.get(s.meta.toolUseId) : null;
    if (use) linked.add(s.meta.toolUseId);
    return { s, use, toolUseId: s.meta?.toolUseId ?? null };
  });
  for (const [toolUseId, use] of r.toolUses) if (!linked.has(toolUseId)) agents.push({ s: null, use, toolUseId });
  const byAgent = new Map();
  for (const c of r.calls.values()) byAgent.set(c.agentId ?? 'main', (byAgent.get(c.agentId ?? 'main') ?? 0) + c.tokens);

  const list = agents.map(({ s, use, toolUseId }) => {
    const background = s?.meta?.requestShape === 'background' || use?.input?.run_in_background === true;
    const result = toolUseId ? r.results.get(toolUseId) : null;
    const ended = background ? s?.handback : result;
    const status = ended ? 'done' : !running ? 'ended' : s ? 'running' : 'starting';
    return {
      agentId: s?.agentId ?? null,
      type: s?.meta?.agentType ?? use?.input?.subagent_type ?? 'subagent',
      description: s?.meta?.description ?? use?.input?.description ?? null,
      background,
      model: s?.model ?? null,
      status,
      tokens: s ? byAgent.get(s.agentId) ?? 0 : 0,
      startedAt: use?.at ?? s?.firstAt ?? null,
      lastAt: s?.lastAt ?? null,
      endedAt: ended?.at ?? null,
      replyWords: ended?.words ?? null,
      toolUseId,
    };
  }).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  // Two subagents of one type are told apart by their order.
  const counts = new Map();
  for (const a of list) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  const seen = new Map();
  for (const a of list) {
    seen.set(a.type, (seen.get(a.type) ?? 0) + 1);
    a.label = counts.get(a.type) > 1 ? `${a.type} ${seen.get(a.type)}` : a.type;
  }
  const label = new Map(list.filter((a) => a.agentId).map((a) => [a.agentId, a.label]));

  const leadCalls = [...r.calls.values()].filter((c) => !c.agentId).sort((a, b) => a.at.localeCompare(b.at));
  const last = leadCalls.at(-1) ?? null;
  const total = [...r.calls.values()].reduce((sum, c) => sum + c.tokens, 0);
  const caps = parseJson(run.caps);

  const log = r.log.map((l) => ({ at: l.at, agent: l.agentId ? label.get(l.agentId) ?? 'subagent' : 'main', action: l.action, detail: l.detail }));
  // A foreground subagent's result reaches the lead agent through its Agent call.
  for (const a of list) {
    if (!a.background && a.status === 'done') log.push({ at: a.endedAt, agent: a.label, action: 'result', detail: `→ main (${a.replyWords} words)` });
  }
  for (const ev of events) {
    const data = parseJson(ev.data) ?? {};
    log.push(ev.kind === 'blocked'
      ? { at: ev.at, agent: ev.agent ?? 'main', action: 'blocked', detail: `${(data.subcommands ?? []).join(' && ')} (chained commands refused)` }
      : { at: ev.at, agent: ev.agent ?? 'hook', action: 'error', detail: String(data.message ?? '') });
  }
  log.sort((a, b) => a.at.localeCompare(b.at));

  return {
    run: { id: run.id, kind: run.kind, status: run.status, area: run.area, startedAt: run.started_at, endedAt: run.ended_at, caps },
    transcript: r.main ? 'available' : 'unavailable',
    lead: {
      model: last?.model ?? null,
      lastCall: last ? { at: last.at, context: last.context, output: last.output } : null,
      calls: leadCalls.length,
      waitingFor: list.filter((a) => !a.background && (a.status === 'running' || a.status === 'starting')).map((a) => a.label),
    },
    agents: list,
    log: log.slice(-LOG_LINES),
    logTotal: log.length,
    tokens: { total, main: byAgent.get('main') ?? 0 },
    cap: caps?.maxTokens ? { tokens: caps.maxTokens, share: total / caps.maxTokens, turns: caps.maxTurns, once: caps.once === true } : null,
    active: list.filter((a) => a.status === 'running' || a.status === 'starting').length,
    elapsedMs: (run.ended_at ? Date.parse(run.ended_at) : now.getTime()) - Date.parse(run.started_at),
  };
}

function textOf(content) {
  if (typeof content === 'string') return content;
  return (Array.isArray(content) ? content : []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

const wordCount = (text) => String(text ?? '').split(/\s+/).filter(Boolean).length;

function quote(text) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  return `"${one.length > 60 ? `${one.slice(0, 57)}...` : one}"`;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
