// A project's board (D177): what is being done now and by which agents, what is left to do, what was done, read
// from open.md, archive.md, digest.md and the database at zero tokens. The same board is shown by the project's own
// viewer and, for every project, by the Director's dashboard. Each text is the plain one when it has been written
// (plain.js), else the project's own, which the next minutes replace.
import { answersToRecord } from './answers.js';
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
  if (/question/i.test(heading)) return 'ask';
  return 'todo';
}

// Whose an item is: a question for the user, asked as a request or not yet; work that waits for the user at a
// session; or work Jérôme does.
export function owner(kind, text) {
  if (kind === 'ask') return /\(asked: R\d+\)/.test(text) ? 'asked' : 'ask';
  if (kind === 'todo' && /interactive session|sessione interattiva/i.test(text)) return 'you';
  return kind;
}

const read = (dir, file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8') : '');

// The board, with each text in plain words (D177): an item whose text is not rewritten yet is left out and counted
// in `pending`, so the board never shows the state files' own words, with their commands and file names. `plain`
// gives a text's plain words or null; `raw` keeps the project's own words instead, for boardTexts.
export function projectBoard(dir, { now = new Date(), code = lang(), plain = (text) => plainText(text, code), raw = false, live = liveRun } = {}) {
  let pending = 0;
  const say = (text) => {
    const own = scrub(text);
    if (!own) return null;
    const p = plain(own);
    if (p === null || p === undefined) {
      if (raw) return own.slice(0, TEXT);
      pending++;
      return null;
    }
    return scrub(p).slice(0, TEXT);
  };
  const shown = (list) => list.filter((x) => x.text);
  const open = sections(read(dir, STATE.open));
  // A question whose request was answered or dropped waits no more for the user, only to be recorded (D192).
  const settled = new Set(answersToRecord(dir).map((r) => r.id));
  const waiting = (x) => !(x.kind === 'ask' && settled.has(Number(x.text.match(/\(asked: R(\d+)\)/)?.[1])));
  const todo = shown(open.map((x) => ({ ...x, kind: kindOf(x.heading) })).filter((x) => ['todo', 'backlog', 'ask'].includes(x.kind) && waiting(x)).slice(0, TODO)
    .map((x) => ({ id: x.id, text: say(x.text.replace(/\s*\(asked: R\d+\)/, '')), kind: owner(x.kind, x.text) })));
  const parked = shown(open.filter((x) => kindOf(x.heading) === 'parked').slice(0, PARKED).map((x) => ({ id: x.id, text: say(x.text) })));
  // The closed items, newest first by the date each one names.
  const closed = shown(sections(read(dir, STATE.archive)).filter((x) => /closed/i.test(x.heading) && x.id)
    .map((x) => ({ id: x.id, raw: x.text, at: x.text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? null }))
    .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, CLOSED)
    .map((x) => ({ id: x.id, at: x.at, text: say(x.raw.replace(/\s+—\s+done\b.*$/, '')) })));
  // One line of digest.md per heartbeat, newest first.
  const done = shown(read(dir, STATE.digest).split('\n').map((l) => l.match(/^- (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?) · (.+)$/)).filter(Boolean)
    .slice(-DONE).reverse().map((m) => ({ at: m[1], text: say(m[2]) })));

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
      // Only once in plain words: until then the dashboard says it its own way, from the run's reason.
      const d = db.prepare("SELECT ended_at, reason FROM runs WHERE kind = 'heartbeat' AND status = 'done' ORDER BY id DESC LIMIT 1").get();
      const text = d?.reason ? say(d.reason) : null;
      if (text) last = { at: d.ended_at, text };
    } finally {
      db.close();
    }
  }
  return { now: now_, last, todo, done, closed, parked, pending };
}

// Every text of a board as the project writes it, for plain.js to rewrite: the same reading with no rewriting.
export function boardTexts(dir, opts = {}) {
  const texts = new Set();
  projectBoard(dir, { ...opts, raw: true, plain: (text) => (texts.add(text), null) });
  return [...texts].filter(Boolean);
}
