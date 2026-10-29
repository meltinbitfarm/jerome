// A project's board (D177): what is being done now and by which agents, what is left to do, what was done, read
// from open.md, archive.md, digest.md and the database at zero tokens. The same board is shown by the project's own
// viewer and, for every project, by the Director's dashboard. Each text is the plain one when it has been written
// (plain.js), else the project's own, which the next minutes replace.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE } from './paths.js';
import { openDb } from './db.js';
import { liveRun } from './live.js';
import { scrub } from './scrub.js';
import { plainText } from './plain.js';
import { lang } from './i18n.js';

const TODO = 60;
const DONE = 15;
const CLOSED = 20;
const PARKED = 20;
const TEXT = 600;

// The items of a state file, by the section they are under: `O7: text` or `- text`, one per line.
export function sections(text) {
  const out = [];
  let heading = '';
  for (const line of String(text ?? '').split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      heading = h[1];
      continue;
    }
    const item = line.match(/^(?:-\s+)?([A-Z]\d+):\s+(.+)$/) ?? line.match(/^-\s+()(.+)$/);
    if (item && heading) out.push({ heading, id: item[1] || null, text: item[2].trim() });
  }
  return out;
}

// What a heading of open.md holds: work to do, work for when time is spare, ideas not to do, or what the board
// leaves out (the assumptions and the requests, which the database holds).
export function kindOf(heading) {
  if (/assumption|decision request/i.test(heading)) return null;
  if (/park|idea/i.test(heading)) return 'parked';
  if (/backlog/i.test(heading)) return 'backlog';
  return 'todo';
}

const read = (dir, file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8') : '');

// The board, with each text as `plain` makes it: by default the plain text written so far, else the project's own.
export function projectBoard(dir, { now = new Date(), code = lang(), plain = (text) => plainText(text, code) ?? text, live = liveRun } = {}) {
  const say = (text) => scrub(plain(scrub(text))).slice(0, TEXT);
  const open = sections(read(dir, STATE.open));
  const todo = open.map((x) => ({ ...x, kind: kindOf(x.heading) })).filter((x) => x.kind === 'todo' || x.kind === 'backlog').slice(0, TODO)
    .map((x) => ({ id: x.id, text: say(x.text), kind: x.kind }));
  const parked = open.filter((x) => kindOf(x.heading) === 'parked').slice(0, PARKED).map((x) => ({ id: x.id, text: say(x.text) }));
  // The closed items, newest first by the date each one names.
  const closed = sections(read(dir, STATE.archive)).filter((x) => /closed/i.test(x.heading) && x.id)
    .map((x) => ({ id: x.id, raw: x.text, at: x.text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? null }))
    .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, CLOSED)
    .map((x) => ({ id: x.id, at: x.at, text: say(x.raw.replace(/\s+—\s+done\b.*$/, '')) }));
  // One line of digest.md per heartbeat, newest first.
  const done = read(dir, STATE.digest).split('\n').map((l) => l.match(/^- (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?) · (.+)$/)).filter(Boolean)
    .slice(-DONE).reverse().map((m) => ({ at: m[1], text: say(m[2]) }));

  let now_ = null;
  let last = null;
  const db = openDb(dir, { readOnly: true, migrate: false });
  if (db) {
    try {
      const run = db.prepare("SELECT id, started_at, reason, triage FROM runs WHERE kind = 'heartbeat' AND status = 'running' ORDER BY id DESC LIMIT 1").get();
      if (run) {
        let task = null;
        try {
          task = JSON.parse(run.triage ?? 'null')?.task ?? null;
        } catch {
          // No verdict kept.
        }
        let agents = [];
        try {
          agents = (live(dir, run.id, { now }).agents ?? []).filter((a) => a.status === 'running' || a.status === 'starting')
            .slice(0, 20).map((a) => ({ name: scrub(a.label).slice(0, 60), what: a.description ? say(a.description) : null, status: a.status }));
        } catch {
          // No transcript to read yet.
        }
        now_ = { startedAt: run.started_at, task: task ? say(task) : null, agents };
      }
      const d = db.prepare("SELECT ended_at, reason FROM runs WHERE kind = 'heartbeat' AND status = 'done' ORDER BY id DESC LIMIT 1").get();
      if (d) last = { at: d.ended_at, text: say(d.reason ?? '') };
    } finally {
      db.close();
    }
  }
  return { now: now_, last, todo, done, closed, parked };
}

// Every text of a board as the project writes it, for plain.js to rewrite: the same reading with no rewriting.
export function boardTexts(dir, opts = {}) {
  const texts = new Set();
  projectBoard(dir, { ...opts, plain: (text) => (texts.add(text), text) });
  return [...texts].filter(Boolean);
}
