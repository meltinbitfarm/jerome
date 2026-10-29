'use strict';
// A project's board (D177), drawn the same way by the Director's dashboard and by the project's own viewer, which
// both put this file inline: what is being done now and by whom, what is left, what was done; and the legend of the
// short IDs the state files use. Every text is set with textContent.
const BOARD_WORDS = {
  en: {
    now: 'Now', since: (ago) => `working since ${ago}`, starting: 'starting', noAgents: 'the lead agent works on its own',
    todo: (n) => `To do (${n})`, backlog: (n) => `When there is spare time (${n})`, done: 'Done lately',
    closed: (n) => `Items closed (${n})`, parked: (n) => `Ideas set aside, not to do now (${n})`,
    none: 'nothing', noBoard: 'The board comes with the Mac\'s next beat.',
    legend: 'Legend: what D1, O1, A1, R1… mean',
    ids: {
      D: ['Decision', 'a choice you made or confirmed; it holds until you change it'],
      O: ['Open item', 'a piece of work to do in the project'],
      A: ['Assumption', 'a choice Jérôme made on its own, without asking you; you can always overturn it'],
      R: ['Request', 'a question Jérôme asks you; you answer it (Telegram or a session)'],
      Q: ['Open question', 'a point still to settle, from the brief'],
      P: ['Parked idea', 'worth remembering, not to do for now'],
    },
    terms: [
      ['Run', 'one round of work Jérôme does by itself in a project'],
      ['Turn', 'a run at a fixed time, such as the 07:30 news'],
      ['Fill run', 'a run started because the week\'s quota is behind its pace, so what is left is not lost'],
      ['Pace', 'how much of the week\'s quota should be used by now'],
      ['Reserve', 'the part of the week\'s quota Jérôme leaves to you'],
      ['Milestone', 'the stage an area of the project is working towards, with its criteria'],
      ['Backlog', 'work for when there is spare time: tests, tidying, research'],
    ],
  },
  it: {
    now: 'Adesso', since: (ago) => `al lavoro da ${ago}`, starting: 'sta partendo', noAgents: 'l\'agente principale lavora da solo',
    todo: (n) => `Da fare (${n})`, backlog: (n) => `Quando avanza tempo (${n})`, done: 'Fatto di recente',
    closed: (n) => `Voci chiuse (${n})`, parked: (n) => `Idee parcheggiate, da non fare ora (${n})`,
    none: 'niente', noBoard: 'Il quadro arriva col prossimo battito del Mac.',
    legend: 'Leggenda: cosa vogliono dire D1, O1, A1, R1…',
    ids: {
      D: ['Decisione', 'una scelta presa o confermata da te; vale finché non la cambi'],
      O: ['Voce aperta', 'un lavoro da fare nel progetto'],
      A: ['Assunzione', 'una scelta fatta da Jérôme da solo, senza chiederti; puoi sempre ribaltarla'],
      R: ['Richiesta', 'una domanda che Jérôme ti fa; rispondi tu (Telegram o una sessione)'],
      Q: ['Domanda aperta', 'un punto ancora da chiarire, nato dal brief'],
      P: ['Idea parcheggiata', 'da ricordare, ma da non fare per ora'],
    },
    terms: [
      ['Run', 'un giro di lavoro che Jérôme fa da solo in un progetto'],
      ['Turno', 'una run a orario fisso, come le notizie delle 07:30'],
      ['Riempimento', 'una run partita perché la quota della settimana è indietro sul passo, così quella avanzata non va persa'],
      ['Passo', 'quanta quota della settimana dovrebbe essere usata a quest\'ora'],
      ['Riserva', 'la parte della quota settimanale che Jérôme lascia a te'],
      ['Milestone', 'la tappa verso cui lavora un\'area del progetto, con i suoi criteri'],
      ['Backlog', 'lavori per quando avanza tempo: test, riordino, ricerca'],
    ],
  },
};

const boardWords = (lang) => BOARD_WORDS[lang] ?? BOARD_WORDS.en;

// How long since a time: "12 min", "2 h".
function boardDuration(iso) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

// The tag of an ID, its meaning on hover or long press.
function idTag(id, lang, el) {
  if (!id) return null;
  const meaning = boardWords(lang).ids[id[0]];
  return el('span', { class: 'tag', title: meaning ? `${meaning[0]}: ${meaning[1]}` : null }, id);
}

function boardList(items, lang, el, dated = false) {
  if (!items.length) return el('div', { class: 'muted small' }, boardWords(lang).none);
  return el('ul', { class: 'board-list' }, items.map((x) => el('li', {},
    dated && x.at ? el('span', { class: 'muted small' }, `${x.at.slice(5, 10).split('-').reverse().join('/')}${x.at.length > 10 ? ` ${x.at.slice(11, 16)}` : ''} `) : null,
    idTag(x.id, lang, el), x.text)));
}

// The board as an element.
function boardView(board, { lang, el }) {
  const w = boardWords(lang);
  if (!board) return el('div', { class: 'muted small' }, w.noBoard);
  const parts = [];
  if (board.now) {
    parts.push(el('div', { class: 'board-now' },
      el('div', {}, el('span', { class: 'running' }, `▶ ${w.now}`), el('span', { class: 'muted small' }, ` · ${w.since(boardDuration(board.now.startedAt))}`)),
      board.now.task ? el('div', { class: 'card-text' }, board.now.task) : null,
      board.now.agents.length
        ? el('ul', { class: 'board-list' }, board.now.agents.map((a) => el('li', {}, el('strong', {}, a.name), a.what ? ` — ${a.what}` : '', a.status === 'starting' ? el('span', { class: 'muted small' }, ` (${w.starting})`) : null)))
        : el('div', { class: 'muted small' }, w.noAgents)));
  }
  const todo = board.todo.filter((x) => x.kind !== 'backlog');
  const backlog = board.todo.filter((x) => x.kind === 'backlog');
  parts.push(el('h4', {}, w.todo(todo.length)), boardList(todo, lang, el));
  if (backlog.length) parts.push(el('details', {}, el('summary', {}, w.backlog(backlog.length)), boardList(backlog, lang, el)));
  parts.push(el('h4', {}, w.done), boardList(board.done, lang, el, true));
  if (board.closed.length) parts.push(el('details', {}, el('summary', {}, w.closed(board.closed.length)), boardList(board.closed, lang, el, true)));
  if (board.parked.length) parts.push(el('details', {}, el('summary', {}, w.parked(board.parked.length)), boardList(board.parked, lang, el)));
  return el('div', { class: 'board' }, parts);
}

// The legend of the IDs and of the words the pages use.
function legendView(lang, el) {
  const w = boardWords(lang);
  return el('details', { class: 'legend' }, el('summary', {}, w.legend),
    el('dl', {}, Object.entries(w.ids).flatMap(([id, [name, what]]) => [el('dt', {}, el('span', { class: 'tag' }, `${id}1`), ` ${name}`), el('dd', {}, what)]),
      w.terms.flatMap(([name, what]) => [el('dt', {}, name), el('dd', {}, what)])));
}
