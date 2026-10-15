// The messages between the lead agent and its subagents in one run (D67), read from Claude Code's transcripts at
// the moment they are asked for. The database stores no contents, and nothing read here is copied or cached.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeConfigDir } from './claude.js';

// The session's transcript: Claude Code keeps it under ~/.claude/projects/<folder>/<session_id>.jsonl.
export function findTranscript(sessionId) {
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) return null;
  const root = join(claudeConfigDir(), 'projects');
  if (!existsSync(root)) return null;
  for (const folder of readdirSync(root)) {
    const path = join(root, folder, `${sessionId}.jsonl`);
    if (existsSync(path)) return path;
  }
  return null;
}

function lines(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

// Each delegation of the run: the agent, the task the lead agent gave it, its reply and its length. A subagent in
// the background replies through SubagentHandback; one in the foreground with its final text.
export function delegations(transcript, sessionId) {
  const tasks = new Map();
  for (const e of lines(transcript)) {
    if (e.type !== 'assistant') continue;
    for (const c of e.message?.content ?? []) {
      if (c.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task')) {
        tasks.set(c.id, { agentType: c.input?.subagent_type ?? null, description: c.input?.description ?? null, prompt: c.input?.prompt ?? '', at: e.timestamp ?? null });
      }
    }
  }
  const folder = join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  const found = [];
  const used = new Set();
  if (existsSync(folder)) {
    for (const file of readdirSync(folder).filter((f) => f.endsWith('.jsonl')).sort()) {
      let meta = {};
      try {
        meta = JSON.parse(readFileSync(join(folder, file.replace(/\.jsonl$/, '.meta.json')), 'utf8'));
      } catch {
        // Without its meta file the delegation is still shown, without its link to the task.
      }
      const entries = lines(join(folder, file));
      const task = tasks.get(meta.toolUseId);
      if (task) used.add(meta.toolUseId);
      const firstUser = entries.find((e) => e.type === 'user');
      let reply = '';
      for (const e of entries) {
        if (e.type !== 'assistant') continue;
        const handback = (e.message?.content ?? []).find((c) => c.type === 'tool_use' && c.name === 'SubagentHandback');
        if (handback && typeof handback.input?.message === 'string') reply = handback.input.message;
        else if (textOf(e.message?.content).trim()) reply = textOf(e.message.content);
      }
      found.push({
        agentId: file.replace(/^agent-/, '').replace(/\.jsonl$/, ''),
        agentType: meta.agentType ?? task?.agentType ?? null,
        description: meta.description ?? task?.description ?? null,
        background: meta.requestShape === 'background',
        at: task?.at ?? firstUser?.timestamp ?? null,
        task: task?.prompt ?? textOf(firstUser?.message?.content),
        reply,
        replyWords: reply.split(/\s+/).filter(Boolean).length,
      });
    }
  }
  // A delegation whose subagent left no transcript still shows its task.
  for (const [id, task] of tasks) {
    if (!used.has(id)) found.push({ agentId: null, agentType: task.agentType, description: task.description, background: false, at: task.at, task: task.prompt, reply: '', replyWords: 0 });
  }
  return found.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
