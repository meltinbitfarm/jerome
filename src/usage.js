// Reading token usage from Claude Code's transcripts into the project database (D20, D53). Each transcript is
// read from where the previous read stopped; a transcript shorter than that offset has been rewritten, and is
// read again from the start. Calls are deduplicated by requestId, so reading a line twice never counts it twice.
// A response written as several lines repeats its requestId, but not always the same usage: output_tokens grows
// until the last line. Each field keeps its largest value, which is the final one even across separate reads.
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { USAGE_DAYS, daysBefore } from './db.js';

const CHUNK = 1 << 20;

// Reads the new lines of one transcript. agent is 'main' for the lead agent's session, or the subagent's type.
// Returns { calls, offset }: the calls added and the new offset.
export function ingestTranscript(db, { path, agent, agentId = null, runId = null, now = new Date() }) {
  const size = statSync(path).size;
  const row = db.prepare('SELECT offset FROM transcript_reads WHERE path = ?').get(path);
  let offset = row ? row.offset : 0;
  if (offset > size) offset = 0;

  // Rows older than the retention period are already summed in usage_daily: reading them again would count them twice.
  const cutoff = daysBefore(now, USAGE_DAYS);
  const insert = db.prepare(`INSERT INTO usage
    (request_id, run_id, agent, agent_id, model, input, output, cache_read, cache_write_5m, cache_write_1h, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (request_id) DO UPDATE SET
      input = max(input, excluded.input), output = max(output, excluded.output),
      cache_read = max(cache_read, excluded.cache_read), cache_write_5m = max(cache_write_5m, excluded.cache_write_5m),
      cache_write_1h = max(cache_write_1h, excluded.cache_write_1h)`);
  const count = db.prepare('SELECT count(*) n FROM usage');
  const fd = openSync(path, 'r');
  db.exec('BEGIN IMMEDIATE');
  const before = count.get().n;
  let calls = 0;
  try {
    let pending = Buffer.alloc(0);
    let position = offset;
    for (;;) {
      const buffer = Buffer.alloc(CHUNK);
      const read = readSync(fd, buffer, 0, CHUNK, position);
      if (read === 0) break;
      position += read;
      pending = Buffer.concat([pending, buffer.subarray(0, read)]);
      // Only complete lines are read: a line still being written is left for the next read.
      const end = pending.lastIndexOf(0x0a);
      if (end === -1) continue;
      for (const line of pending.subarray(0, end).toString('utf8').split('\n')) {
        const call = parseCall(line);
        if (!call || call.at < cutoff) continue;
        insert.run(call.requestId, runId, agent, agentId, call.model, call.input, call.output,
          call.cache_read, call.cache_write_5m, call.cache_write_1h, call.at);
      }
      offset += end + 1;
      pending = pending.subarray(end + 1);
    }
    db.prepare(`INSERT INTO transcript_reads (path, offset, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (path) DO UPDATE SET offset = excluded.offset, updated_at = excluded.updated_at`)
      .run(path, offset, now.toISOString());
    calls = count.get().n - before;
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    closeSync(fd);
  }
  return { calls, offset };
}

// The usage of one assistant line, or null. Only key names, numbers and the model are read, never contents.
export function parseCall(line) {
  if (!line.includes('"requestId"')) return null;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  const u = e.type === 'assistant' ? e.message?.usage : null;
  if (!u || !e.requestId || !e.message.model || !e.timestamp) return null;
  const total = u.cache_creation_input_tokens ?? 0;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? total - write1h;
  return {
    requestId: e.requestId,
    model: e.message.model,
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cache_read: u.cache_read_input_tokens ?? 0,
    cache_write_5m: write5m,
    cache_write_1h: write1h,
    at: new Date(e.timestamp).toISOString(),
  };
}
