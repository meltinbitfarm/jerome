'use strict';
// A project's board (D177), drawn the same way by the Director's dashboard and by the project's own viewer, which
// both put this file inline: what is being done now and by whom, what is left, what was done; and the legend of the
// short IDs the state files use. Every text is set with textContent.
const BOARD_WORDS = {
  en: {
    now: 'Now', since: (ago) => `working since ${ago}`, starting: 'starting',
    todo: (n) => `Jérôme does (${n})`, asks: (n) => `Questions for you (${n})`, asksHow: 'Jérôme asks them one at a time, as requests with buttons on Telegram.', asked: 'asked, waiting for your answer', yours: (n) => `Once left for a session: Jérôme takes them up, or asks you (${n})`, backlog: (n) => `When there is spare time (${n})`, done: 'Done lately',
    closed: (n) => `Items closed (${n})`, parked: (n) => `Ideas set aside, not to do now (${n})`,
    none: 'nothing', noBoard: 'The board comes with the Mac\'s next beat.',
    more: (n) => `${n} more`, parkedHow: 'Each one comes back to you as a question when its date comes, or when the milestone changes.', pending: (n) => `${n} ${n === 1 ? 'text is' : 'texts are'} being put in plain words: they show in a minute or two.`,
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
    now: 'Adesso', since: (ago) => `al lavoro da ${ago}`, starting: 'sta partendo',
    todo: (n) => `Fa Jérôme (${n})`, asks: (n) => `Domande per te (${n})`, asksHow: 'Jérôme te le fa una alla volta, come richieste con i pulsanti su Telegram.', asked: 'già chiesta, aspetta la tua risposta', yours: (n) => `Lasciate per una sessione: Jérôme le riprende, o te le chiede (${n})`, backlog: (n) => `Quando avanza tempo (${n})`, done: 'Fatto di recente',
    closed: (n) => `Voci chiuse (${n})`, parked: (n) => `Idee parcheggiate, da non fare ora (${n})`,
    none: 'niente', noBoard: 'Il quadro arriva col prossimo battito del Mac.',
    more: (n) => `altre ${n}`, parkedHow: 'Ognuna torna da te come domanda quando arriva la sua data, o quando cambia la milestone.', pending: (n) => `${n} ${n === 1 ? 'testo è' : 'testi sono'} in riscrittura: compaiono tra un paio di minuti.`,
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

// The parts opened by the user, by key, so a refresh of the page, which draws everything again, keeps them open.
const BOARD_OPEN = new Set();
function remember(node, key) {
  if (!key) return node;
  if (BOARD_OPEN.has(key)) node.open = true;
  node.addEventListener('toggle', () => { if (node.open) BOARD_OPEN.add(key); else BOARD_OPEN.delete(key); });
  return node;
}

// How long since a time: "12 min", "2 h".
function boardDuration(iso) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

// The tag of an ID, its meaning on hover or long press.
function idTag(id, lang, el) {
  if (!id) return null;
  const meaning = boardWords(lang).ids[id[0]];
  return el('span', { class: `tag tag-${id[0]}`, title: meaning ? `${meaning[0]}: ${meaning[1]}` : null }, id);
}

// A list as a checklist: ☐ to do, ✓ done; the first `first` shown, the others under "and N more".
function boardList(items, lang, el, { mark = '☐', dated = false, first = 8, key = null } = {}) {
  const w = boardWords(lang);
  if (!items.length) return el('div', { class: 'muted small' }, w.none);
  const line = (x) => el('li', {}, el('span', { class: mark === '✓' ? 'mark ok' : 'mark' }, mark),
    el('span', {}, x.text, ' ', idTag(x.id, lang, el),
      dated && x.at ? el('span', { class: 'muted small' }, ` ${x.at.slice(5, 10).split('-').reverse().join('/')}${x.at.length > 10 ? ` ${x.at.slice(11, 16)}` : ''}`) : null));
  const list = el('ul', { class: 'board-list' }, items.slice(0, first).map(line));
  if (items.length <= first) return list;
  return el('div', {}, list, remember(el('details', {}, el('summary', {}, w.more(items.length - first)), el('ul', { class: 'board-list' }, items.slice(first).map(line))), key && `${key}:more`));
}

// A part's title: an icon and a colour of its own, so the parts are told apart at a glance.
function boardHead(el, icon, text, tone) {
  return el('h4', { class: `board-head ${tone}` }, el('span', { class: 'icon', 'aria-hidden': 'true' }, icon), text);
}
const fold = (el, icon, text, tone, body, key) => remember(el('details', { class: 'board-fold' }, el('summary', { class: tone }, `${icon} ${text}`), body), key);

// The board as an element.
function boardView(board, { lang, el, key = 'board' }) {
  const w = boardWords(lang);
  if (!board) return el('div', { class: 'muted small' }, w.noBoard);
  const parts = [];
  if (board.now) {
    parts.push(el('div', { class: 'board-now' },
      el('div', {}, el('span', { class: 'running' }, `▶ ${w.now}`), el('span', { class: 'muted small' }, ` · ${w.since(boardDuration(board.now.startedAt))}`)),
      board.now.task ? el('div', {}, board.now.task) : null,
      board.now.agents.length
        ? el('ul', { class: 'board-list agents-now' }, board.now.agents.map((a) => el('li', {}, el('span', { class: 'mark running' }, '●'),
          el('span', {}, el('strong', {}, a.name), a.what ? ` · ${a.what}` : '', a.status === 'starting' ? el('span', { class: 'muted small' }, ` (${w.starting})`) : null))))
        : null));
  }
  const of = (...kinds) => board.todo.filter((x) => kinds.includes(x.kind));
  const todo = of('todo');
  const backlog = of('backlog');
  // The user's part first: questions for them, asked or still to ask, and work that waits for them.
  const asks = of('ask', 'asked');
  if (asks.length) {
    parts.push(boardHead(el, '❓', w.asks(asks.length), 'warn'), el('div', { class: 'muted small' }, w.asksHow),
      boardList(asks.map((x) => ({ ...x, text: x.kind === 'asked' ? `${x.text} (${w.asked})` : x.text })), lang, el, { mark: '?', key: `${key}:asks` }));
  }
  const yours = of('you');
  if (yours.length) parts.push(boardHead(el, '🙋', w.yours(yours.length), 'warn'), boardList(yours, lang, el, { key: `${key}:yours` }));
  // While texts are being rewritten an empty list is not "nothing": it is not written yet.
  const waiting = board.pending ? el('div', { class: 'muted small' }, w.pending(board.pending)) : null;
  parts.push(boardHead(el, '🛠', w.todo(todo.length), 'cyan'), todo.length || !waiting ? boardList(todo, lang, el, { key: `${key}:todo` }) : waiting);
  if (backlog.length) parts.push(fold(el, '⏳', w.backlog(backlog.length), 'muted', boardList(backlog, lang, el, { first: 50 }), `${key}:backlog`));
  parts.push(boardHead(el, '✅', w.done, 'ok'), board.done.length || !waiting ? boardList(board.done, lang, el, { mark: '✓', dated: true, first: 5, key: `${key}:done` }) : waiting);
  if (board.closed.length) parts.push(fold(el, '📦', w.closed(board.closed.length), 'muted', boardList(board.closed, lang, el, { mark: '✓', dated: true, first: 50 }), `${key}:closed`));
  if (board.parked.length) parts.push(fold(el, '💡', w.parked(board.parked.length), 'muted', el('div', {}, el('div', { class: 'muted small' }, w.parkedHow), boardList(board.parked, lang, el, { mark: '·', first: 50 })), `${key}:parked`));
  if (waiting && (todo.length || board.done.length)) parts.push(waiting);
  return el('div', { class: 'board' }, parts);
}

// The legend of the IDs and of the words the pages use.
function legendView(lang, el) {
  const w = boardWords(lang);
  return remember(el('details', { class: 'legend' }, el('summary', {}, w.legend),
    el('dl', {}, Object.entries(w.ids).flatMap(([id, [name, what]]) => [el('dt', {}, el('span', { class: `tag tag-${id}` }, `${id}1`), ` ${name}`), el('dd', {}, what)]),
      w.terms.flatMap(([name, what]) => [el('dt', {}, name), el('dd', {}, what)]))), 'legend');
}

// The help panel behind the pages' "?" button: what the page shows, in the user's language, the legend, and the guides
// on GitHub, which are in English and not in the installed package.
const DOCS = 'https://github.com/meltinbitfarm/jerome/blob/main/';
const HELP_WORDS = {
  en: {
    title: 'Help', button: 'Help: what this page shows, and the guides', guides: 'The guides, on GitHub',
    pages: {
      view: 'This page shows one project, and only reads. At the top, the board: what Jérôme is doing now, what is left and what was done, in plain words. Below, the subscription\'s windows, the open requests, the team, the latest runs and the usage. To answer a question, use Telegram or a session in the project.',
      director: 'This page shows every Mac and every project on your Claude account. At the top, what waits for you: answer a question with a tap or in your own words, clear a block with its buttons. Then each project, with its board and a box for a note; then the week\'s quota and its pace. Under the details, the Macs, the latest runs and the past weeks. What you send reaches the Mac within a minute, and the Mac tells you on Telegram.',
    },
    links: [['How to use it', 'README.md#using-it'], ['Why Jérôme works this way', 'docs/why.md'], ['A project from start to finish', 'docs/guide.md'], ['The board', 'docs/board.md'], ['Telegram', 'docs/telegram.md'], ['The quota governor', 'docs/quota-governor.md'], ['Jérôme Director', 'docs/director.md']],
  },
  it: {
    title: 'Aiuto', button: 'Aiuto: cosa mostra questa pagina, e le guide', guides: 'Le guide, su GitHub (in inglese)',
    pages: {
      view: 'Questa pagina mostra un progetto, in sola lettura. In alto il quadro: cosa sta facendo Jérôme adesso, cosa resta e cosa è stato fatto, in parole semplici. Sotto, le finestre dell\'abbonamento, le richieste aperte, il team, le ultime run e i consumi. Per rispondere a una domanda usa Telegram o una sessione nel progetto.',
      director: 'Questa pagina mostra tutti i Mac e tutti i progetti del tuo account Claude. In alto quello che aspetta te: rispondi a una domanda con un tocco o con parole tue, sblocca un problema coi suoi pulsanti. Poi ogni progetto, col suo quadro e un riquadro per una nota; poi la quota della settimana e il suo passo. Nei dettagli, i Mac, le ultime run e le settimane passate. Quello che mandi arriva al Mac entro un minuto, e il Mac te lo conferma su Telegram.',
    },
    links: [['Come si usa', 'README.md#using-it'], ['Perché Jérôme funziona così', 'docs/why.md'], ['Un progetto dall\'inizio alla fine', 'docs/guide.md'], ['Il quadro', 'docs/board.md'], ['Telegram', 'docs/telegram.md'], ['Il governatore della quota', 'docs/quota-governor.md'], ['Jérôme Director', 'docs/director.md']],
  },
};

// The panel's content, for the page `page` (view, director).
function helpView(lang, el, page) {
  const w = HELP_WORDS[lang] ?? HELP_WORDS.en;
  return el('div', {}, el('h3', {}, w.title), el('p', {}, w.pages[page]), legendView(lang, el), el('h4', {}, w.guides),
    el('ul', { class: 'help-links' }, w.links.map(([text, path]) => el('li', {}, el('a', { href: DOCS + path, target: '_blank', rel: 'noopener noreferrer' }, text)))));
}

// The "?" button shows and hides the panel; its label follows the language.
function helpButton(button, panel, lang) {
  const w = HELP_WORDS[lang] ?? HELP_WORDS.en;
  button.title = w.button;
  button.setAttribute('aria-label', w.button);
  if (button.dataset.wired) return;
  button.dataset.wired = '1';
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
}
