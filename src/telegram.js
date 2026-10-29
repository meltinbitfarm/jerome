// The Telegram bridge (D130-D133): one bot, one chat (the user's), for every project on this machine, run by a
// listener of its own that the watchdog job (D134) keeps alive (D184). Out: what waits for the user, queued by notify() and by a request opened. In: an
// answer to a decision request (a button, or a reply to its message), a note for a project, /status and /help.
// Nothing else: the bridge runs no shell, passes no text as arguments to anything but `jerome request answer`, and
// calls no model. The token stays on this machine, in a file only the user can read, never in a project.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { stores } from './store.js';
import { addNote } from './notes.js';
import { t } from './i18n.js';
import { readAccount } from './account.js';
import { blockMessage, howLong } from './blocks.js';
import { ACTIONS, actionsFor, runAction } from './unblock.js';
import { VERSION } from './template.js';
import { cacheDir } from './runstate.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'jerome.js');
// Telegram refuses longer messages.
const MAX_TEXT = 4000;
// The messages the bridge remembers, to know what a reply or a button is about.
const KEEP_SENT = 500;
// A queued message Telegram keeps refusing is dropped after this long.
const OUTBOX_DAYS = 2;
// The longest a poll of Telegram waits for an update: what is queued to send waits at most this long too.
const POLL_SECONDS = 10;
// The listener ends after this long, and the watchdog starts a new one at its next pass.
const LISTENER_MS = 30 * 60_000;

export function configPath() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'jerome', 'telegram.json');
}

function dataDir() {
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'jerome', 'telegram');
}

const outboxPath = () => join(dataDir(), 'outbox.jsonl');
const statePath = () => join(dataDir(), 'state.json');

export function readConfig() {
  try {
    const c = JSON.parse(readFileSync(configPath(), 'utf8'));
    return c.token && c.chatId ? c : null;
  } catch {
    return null;
  }
}

// The token file and its folder, readable by the user only.
export function writeConfig(config) {
  mkdirSync(dirname(configPath()), { recursive: true, mode: 0o700 });
  chmodSync(dirname(configPath()), 0o700);
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(configPath(), 0o600);
}

// Queues a message for the user (D131), when the bridge is set up: { dir, text, request? }.
export function enqueue({ dir = null, text, request = null, alert = null, now = new Date() }) {
  if (!readConfig()) return;
  mkdirSync(dataDir(), { recursive: true });
  appendFileSync(outboxPath(), `${JSON.stringify({ at: now.toISOString(), dir, project: dir ? basename(dir) : null, text, request, alert })}\n`);
}

function readState() {
  try {
    return { offset: 0, sent: {}, pending: {}, ...JSON.parse(readFileSync(statePath(), 'utf8')) };
  } catch {
    return { offset: 0, sent: {}, pending: {} };
  }
}

function writeState(state) {
  const ids = Object.keys(state.sent).map(Number).sort((a, b) => b - a).slice(0, KEEP_SENT);
  const kept = { ...state, sent: Object.fromEntries(ids.map((id) => [id, state.sent[id]])) };
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(`${statePath()}.tmp`, JSON.stringify(kept));
  renameSync(`${statePath()}.tmp`, statePath());
}

// The Bot API. JEROME_TELEGRAM_FAKE names a folder that stands for Telegram in the tests: updates.json is what
// getUpdates returns, and every call is appended to calls.jsonl.
export function telegramApi(token, env = process.env) {
  if (env.JEROME_TELEGRAM_FAKE) {
    const folder = env.JEROME_TELEGRAM_FAKE;
    return async (method, params = {}) => {
      // Message ids keep growing across processes: one per call made so far.
      const next = 1000 + (existsSync(join(folder, 'calls.jsonl')) ? readFileSync(join(folder, 'calls.jsonl'), 'utf8').split('\n').length : 0);
      appendFileSync(join(folder, 'calls.jsonl'), `${JSON.stringify({ method, params })}\n`);
      if (method === 'getUpdates') {
        // Telegram's long polling waits for an update: a short wait here, so a listener gives way to the rest.
        if (params.timeout) await new Promise((r) => setTimeout(r, 50));
        try {
          return JSON.parse(readFileSync(join(folder, 'updates.json'), 'utf8')).filter((u) => u.update_id >= (params.offset ?? 0));
        } catch {
          return [];
        }
      }
      if (method === 'getMe') return { username: 'jerome_test_bot' };
      // Telegram refuses HTML with a mark it does not know or an unescaped "<" or "&".
      if (method === 'sendMessage' && params.parse_mode === 'HTML' && /<(?!\/?[bi]>)|&(?!(amp|lt|gt);)/.test(params.text)) throw new Error('Telegram sendMessage: Bad Request: can\'t parse entities');
      if (method === 'sendMessage') return { message_id: next };
      // Telegram refuses an answer to a tap older than about 15 seconds, and the bridge runs once a minute.
      if (method === 'answerCallbackQuery' && params.callback_query_id?.startsWith('old')) throw new Error('Telegram answerCallbackQuery: Bad Request: query is too old and response timeout expired or query ID is invalid');
      return true;
    };
  }
  return async (method, params = {}) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(30_000),
    });
    const body = await r.json().catch(() => ({}));
    // The error says what Telegram answered, never the URL, which holds the token.
    if (!body.ok) throw new Error(`Telegram ${method}: ${body.description ?? `HTTP ${r.status}`}`);
    return body.result;
  };
}

// The projects of this machine, by name: the registry's, with their folder.
function knownProjects() {
  return stores().filter((s) => !s.orphan && s.record?.path).map((s) => ({ name: basename(s.record.path), dir: s.record.path }));
}

// A request's options as buttons, however the agent wrote them: labelled in order ("A) …", "B: …", "1) …"), split at
// the labels, so a "/" or ";" inside an option stays in it; else separated by " / ", ";", " | " or " · ". Fewer than
// two, or more than six, gives none.
export function optionList(options) {
  const text = String(options ?? '').trim();
  const list = labelled(text) ?? text.split(/\s+\/\s+|\s*;\s*|\s+\|\s+|\s+·\s+/);
  const out = list.map((o) => o.trim()).filter(Boolean);
  return out.length >= 2 && out.length <= 6 ? out : [];
}

// The options split at their labels A, B, C… or 1, 2, 3…, when the text starts with the first and has the next in
// order; the separator before each label is left out.
function labelled(text) {
  const first = text.match(/^([A-Z]|1)[):]\s/);
  if (!first) return null;
  const next = (label) => (/\d/.test(label) ? String(Number(label) + 1) : String.fromCharCode(label.charCodeAt(0) + 1));
  const starts = [0];
  let label = first[1];
  for (;;) {
    label = next(label);
    const at = text.slice(starts.at(-1) + 3).search(new RegExp(`(^|[\\s;·|/,])${label}[):]\\s`));
    if (at < 0) break;
    const from = starts.at(-1) + 3 + at;
    starts.push(from + text.slice(from).indexOf(label));
  }
  if (starts.length < 2) return null;
  return starts.map((at, i) => text.slice(at, starts[i + 1] ?? text.length).replace(/[\s;·|/,]+$/, ''));
}

const clip = (text) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);

// One pass of the bridge: the updates first, then the queue. With `until`, it then keeps listening (Telegram's long
// polling) until that time, so a tap or a message is handled within a second or two rather than at the next minute;
// the queue is sent after each answer. Returns what it did, for the watchdog's log.
export async function bridgeTick({ env = process.env, now = new Date(), api = null, until = null } = {}) {
  const config = readConfig();
  if (!config) return { configured: false };
  const call = api ?? telegramApi(config.token, env);
  const state = readState();
  const done = { configured: true, received: 0, ignored: 0, sent: 0, errors: [] };
  let wait = 0;
  for (;;) {
    let got = 0;
    try {
      const updates = await call('getUpdates', { offset: state.offset, timeout: wait, allowed_updates: ['message', 'callback_query'] });
      got = updates.length;
      for (const u of updates) {
        state.offset = Math.max(state.offset, u.update_id + 1);
        const chat = u.message?.chat ?? u.callback_query?.message?.chat;
        // Only the user's own private chat is heard; anything else is counted and dropped, unread.
        if (!chat || chat.type !== 'private' || String(chat.id) !== String(config.chatId)) {
          done.ignored += 1;
          continue;
        }
        done.received += 1;
        try {
          if (u.callback_query) await onButton(u.callback_query, state, call, config, new Date(), env);
          else if (typeof u.message.text === 'string') await onMessage(u.message, state, call, config, new Date());
        } catch (err) {
          done.errors.push(err.message);
        }
      }
    } catch (err) {
      done.errors.push(err.message);
      got = -1;
    }
    // The state is saved before sending, so an update is never handled twice.
    writeState(state);
    await syncButtons(state, call, config);
    await sendQueue(state, call, config, done, now);
    const left = until ? Math.floor((until - Date.now()) / 1000) : 0;
    // A failed call is not retried in a loop: the next minute tries again.
    if (got < 0 || left < 2) break;
    wait = Math.min(POLL_SECONDS, left - 1);
  }
  return done;
}

// A request's buttons follow it on the messages already sent: taken off once it is closed, answered or dropped
// anywhere, so no tap goes to a question that is not open any more; put on a message of an open request sent with
// none, when its options are read better now than when it was sent.
async function syncButtons(state, call, config) {
  let changed = false;
  for (const [id, about] of Object.entries(state.sent)) {
    if (!about.request || about.cleared) continue;
    const db = openDb(about.dir);
    let row;
    try {
      row = db?.prepare('SELECT status, options FROM requests WHERE id = ?').get(about.request);
    } finally {
      db?.close();
    }
    const open = row?.status === 'open';
    const options = open ? optionList(row.options) : [];
    // Messages remembered before `buttons` was kept may have some: tried, a message already so is refused harmlessly.
    if (open && (about.buttons === true || !options.length)) continue;
    if (!open && about.buttons === false) continue;
    const keyboard = options.map((o, i) => [{ text: o, callback_data: `a:${about.request}:${i}` }]);
    try {
      await call('editMessageReplyMarkup', { chat_id: config.chatId, message_id: Number(id), reply_markup: { inline_keyboard: keyboard } });
    } catch {
      // A message too old to edit keeps what it has: a tap on a closed request says it is closed.
    }
    if (open) about.buttons = true;
    else about.cleared = true;
    changed = true;
  }
  if (changed) writeState(state);
}

async function sendQueue(state, call, config, done, now) {
  const queued = existsSync(outboxPath()) ? readFileSync(outboxPath(), 'utf8').split('\n').filter(Boolean) : [];
  if (!queued.length) return;
  const sending = `${outboxPath()}.sending`;
  renameSync(outboxPath(), sending);
  const left = [];
  for (const line of queued) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    try {
      await send(item, state, call, config);
      done.sent += 1;
    } catch (err) {
      done.errors.push(err.message);
      if (now.getTime() - Date.parse(item.at) < OUTBOX_DAYS * 86_400_000) left.push(line);
    }
  }
  if (left.length) appendFileSync(outboxPath(), `${left.join('\n')}\n`);
  rmSync(sending, { force: true });
  writeState(state);
}

// A message's text, laid out for the phone: the project's name in bold on its own line, then the text; a request with
// its question, each option on its own line, the recommendation, and how to answer in italics. `html` gives it in
// Telegram's HTML, every text escaped, else as plain text, the same lines without the marks.
export function layout(item, html = true) {
  const esc = (x) => (html ? String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : String(x ?? ''));
  const b = (x) => (html ? `<b>${x}</b>` : x);
  const i = (x) => (html ? `<i>${x}</i>` : x);
  // A message about the account, not a project (the quota running fast), has no project's name.
  const head = b(esc(item.project ?? 'Jérôme'));
  const r = item.request;
  if (!r) return `${head}\n${esc(item.text)}`;
  const options = optionList(r.options);
  const lines = [head, `❓ ${b(`R${r.id}`)} ${esc(r.question)}`];
  if (options.length) lines.push('', b(t('request.options')), ...options.map(esc));
  else if (r.options) lines.push('', `${b(t('request.options'))}: ${esc(r.options)}`);
  if (r.recommendation) lines.push('', `💡 ${b(`${t('request.recommended')}:`)} ${esc(r.recommendation)}`);
  lines.push('', i(esc(t(options.length ? 'request.how' : 'request.howReply'))));
  return lines.join('\n');
}

// A queued message, with a request's options as buttons, and remembered, so a button or a reply answers it. Sent in
// Telegram's HTML; should Telegram refuse its marks, the same message goes as plain text, so nothing is lost.
async function send(item, state, call, config) {
  const r = item.request;
  const options = r ? optionList(r.options) : [];
  // A block's actions (D166), one button each: the alert's id and the action's name, nothing else.
  const actions = !r && item.alert?.actions?.length ? item.alert.actions.filter((a) => ACTIONS.includes(a)) : [];
  const keyboard = options.length ? options.map((o, i) => [{ text: o, callback_data: `a:${r.id}:${i}` }])
    : actions.map((a) => [{ text: t(`action.${a}`), callback_data: `x:${item.alert.id}:${a}` }]);
  const markup = keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {};
  const html = layout(item);
  let message;
  try {
    message = await call('sendMessage', { chat_id: config.chatId, text: html.length > MAX_TEXT ? clip(layout(item, false)) : html, ...(html.length > MAX_TEXT ? {} : { parse_mode: 'HTML' }), ...markup });
  } catch (err) {
    if (!/parse entities|can't parse/i.test(err.message)) throw err;
    message = await call('sendMessage', { chat_id: config.chatId, text: clip(layout(item, false)), ...markup });
  }
  state.sent[message.message_id] = { dir: item.dir, project: item.project, request: r?.id ?? null, alert: actions.length ? item.alert.id : null, buttons: keyboard.length > 0 };
}

async function reply(call, config, text, extra = {}) {
  return call('sendMessage', { chat_id: config.chatId, text: clip(text), ...extra });
}

async function onButton(q, state, call, config, now, env) {
  const [kind, a, b] = String(q.data ?? '').split(':');
  const about = state.sent[q.message?.message_id];
  // It only stops the button's spinner, and fails on a tap older than about 15 seconds, which a bridge running once a
  // minute often sees: the tap is still acted on.
  try {
    await call('answerCallbackQuery', { callback_query_id: q.id });
  } catch {
    // Too late to stop the spinner.
  }
  const clearButtons = async () => {
    try {
      await call('editMessageReplyMarkup', { chat_id: config.chatId, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
      if (about) about.cleared = true;
    } catch {
      // The buttons left are harmless: a second tap finds the request answered, or the block closed.
    }
  };
  // A block's action (D167): only on the message that offered it, for its alert, and one of the closed list; the
  // project checks again that the alert is open and offers it.
  if (kind === 'x' && about?.alert === Number(a) && ACTIONS.includes(b)) {
    const done = runAction(about.dir, Number(a), b, { origin: 'telegram', env, now });
    if (done.ok) await clearButtons();
    return reply(call, config, `${about.project}: ${done.text}`);
  }
  if (kind === 'a' && about?.request === Number(a)) {
    const db = openDb(about.dir);
    const row = db?.prepare('SELECT options FROM requests WHERE id = ?').get(Number(a));
    db?.close();
    const option = optionList(row?.options)[Number(b)];
    // The buttons go only once the request is closed: after a failed answer they stay, for another tap.
    if (option && (await answer(about, Number(a), option, call, config))) await clearButtons();
    return;
  }
  // The project chosen for a note that named none.
  if (kind === 'n') {
    const text = state.pending[a];
    const project = knownProjects()[Number(b)];
    delete state.pending[a];
    if (!text || !project) return reply(call, config, t('note.expired'));
    return saveNote(project, text, call, config, now);
  }
  return null;
}

async function onMessage(m, state, call, config, now) {
  const text = m.text.trim();
  const command = text.match(/^\/(\w+)/)?.[1]?.toLowerCase();
  if (command === 'status') return status(state, call, config);
  if (command === 'start' || command === 'help') return reply(call, config, t('bot.help'));
  if (command) return reply(call, config, `${t('bot.unknown')}\n\n${t('bot.help')}`);
  const about = m.reply_to_message ? state.sent[m.reply_to_message.message_id] : null;
  if (about?.request) return answer(about, about.request, text, call, config);
  if (about) return saveNote({ name: about.project, dir: about.dir }, text, call, config, now);
  const projects = knownProjects();
  const tag = text.match(/^#([\w.-]+)\s+([\s\S]+)$/);
  if (tag) {
    const project = projects.find((p) => p.name.toLowerCase() === tag[1].toLowerCase());
    if (!project) return reply(call, config, t('note.unknown', { name: tag[1], list: projects.map((p) => p.name).join(', ') || '—' }));
    return saveNote(project, tag[2].trim(), call, config, now);
  }
  if (!projects.length) return reply(call, config, t('note.none'));
  if (projects.length === 1) return saveNote(projects[0], text, call, config, now);
  // Which project: asked with a button each; the text waits in the bridge's state meanwhile.
  const key = String(m.message_id);
  state.pending[key] = text;
  return reply(call, config, t('note.which'), { reply_markup: { inline_keyboard: projects.map((p, i) => [{ text: p.name, callback_data: `n:${key}:${i}` }]) } });
}

// The answer goes through `jerome request answer`, run without a shell, in the project's folder: the same write as
// in a session, at zero tokens.
async function answer(about, id, text, call, config) {
  const db = openDb(about.dir);
  const row = db?.prepare('SELECT status FROM requests WHERE id = ?').get(id);
  db?.close();
  if (!row) {
    await reply(call, config, t('request.gone', { project: about.project, id }));
    return true;
  }
  if (row.status !== 'open') {
    await reply(call, config, t('request.closed', { project: about.project, id, status: row.status }));
    return true;
  }
  const r = spawnSync(process.execPath, [BIN, 'request', 'answer', String(id), '--', text], { cwd: about.dir, encoding: 'utf8', timeout: 30_000 });
  await reply(call, config, r.status === 0 ? t('request.answered', { project: about.project, id, text }) : t('request.failed', { project: about.project, id, error: (r.stderr || r.stdout).trim() }));
  return r.status === 0;
}

async function saveNote(project, text, call, config, now) {
  const db = openDb(project.dir);
  if (!db) return reply(call, config, t('note.nodb', { project: project.name }));
  let id;
  try {
    id = addNote(db, text, { now });
  } finally {
    db.close();
  }
  return reply(call, config, t('note.saved', { project: project.name, id }));
}

// /status: the summary, then each block that has actions as a message of its own with its buttons (D168).
async function status(state, call, config) {
  const p = projectsNow();
  await reply(call, config, statusText(p));
  for (const x of p?.projects ?? []) {
    for (const a of x.alerts) {
      const actions = actionsFor(a.reason);
      if (actions.length) await send({ dir: x.path, project: x.name, text: `⚠ ${blockMessage(a.reason)} ${howLong(a)}`, alert: { id: a.id, actions } }, state, call, config);
    }
  }
}

function projectsNow() {
  const r = spawnSync(process.execPath, [BIN, 'projects', '--json'], { encoding: 'utf8', timeout: 60_000 });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

// What waits for the user (D161): the open decision requests and the blocks, each as a sentence for a person, from
// `jerome projects`; then the quota.
function statusText(p) {
  if (!p) return t('status.noanswer');
  const windows = readAccount().windows ?? {};
  const live = (w) => (w && (w.resetsAt ?? 0) * 1000 > Date.now() ? w.used : null);
  const quota = live(windows.seven_day) !== null ? `\n\n${t('status.quota', { seven: live(windows.seven_day), five: live(windows.five_hour) })}` : '';
  const waiting = p.projects.filter((x) => x.requests.length || x.alerts.length || x.error);
  if (!waiting.length) return `${t('status.nothing', { n: p.projects.length })}${quota}`;
  const lines = (x) => [
    ...x.requests.map((q) => t('status.request', { id: q.id, question: q.question })),
    ...x.alerts.map((a) => `⚠ ${blockMessage(a.reason)} ${howLong(a)}`),
    ...(x.error ? [`⚠ ${x.error}`] : []),
  ];
  return `${waiting.map((x) => `${x.name}\n${lines(x).join('\n')}`).join('\n\n')}${quota}`;
}

// `jerome telegram setup`: the token, checked; the user's chat, from the first message they send the bot; the
// watchdog job that runs the bridge; a test message.
export async function setup({ env = process.env, input = process.stdin, output = process.stdout, wait = 120_000 } = {}) {
  const rl = createInterface({ input, output, terminal: Boolean(input.isTTY) });
  // Lines are queued as they come, so piped answers are not lost between two questions.
  const lines = [];
  const waiting = [];
  rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
  rl.on('close', () => { while (waiting.length) waiting.shift()(''); });
  let muted = false;
  const write = rl._writeToOutput?.bind(rl);
  // The token is not echoed on a terminal.
  rl._writeToOutput = (text) => { if (!muted) write?.(text); };
  const ask = (q, hidden = false) => {
    output.write(q);
    muted = hidden && Boolean(input.isTTY);
    return new Promise((done) => {
      const answer = (l) => {
        if (muted) output.write('\n');
        muted = false;
        done(String(l).trim());
      };
      if (lines.length) answer(lines.shift());
      else waiting.push(answer);
    });
  };
  try {
    console.log('Create a bot with @BotFather in Telegram (/newbot), then paste its token here. It stays on this machine, in a file only you can read.');
    const token = await ask('Bot token: ', true);
    if (!/^\d+:[\w-]{20,}$/.test(token)) {
      console.error('That does not look like a bot token (digits, a colon, then letters).');
      return 2;
    }
    const call = telegramApi(token, env);
    let me;
    try {
      me = await call('getMe');
    } catch (err) {
      console.error(`Telegram refused the token: ${err.message}`);
      return 1;
    }
    console.log(`Now send /start to @${me.username} from your own Telegram account. Waiting up to ${Math.round(wait / 60_000)} minutes…`);
    let offset = 0;
    let chat = null;
    const until = Date.now() + wait;
    while (!chat && Date.now() < until) {
      const updates = await call('getUpdates', { offset, timeout: env.JEROME_TELEGRAM_FAKE ? 0 : 10, allowed_updates: ['message'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message?.chat?.type === 'private') chat = u.message.chat;
      }
      if (!chat && env.JEROME_TELEGRAM_FAKE) break;
    }
    if (!chat) {
      console.error('No message came: run `jerome telegram setup` again.');
      return 1;
    }
    const who = [chat.first_name, chat.last_name].filter(Boolean).join(' ') + (chat.username ? ` (@${chat.username})` : '');
    const yes = await ask(`The message came from ${who}. Is that you? Only this chat will be heard. [y/N] `);
    if (!/^y(es)?$/i.test(yes)) {
      console.log('Nothing saved.');
      return 1;
    }
    writeConfig({ token, chatId: chat.id, chat: who, bot: me.username, at: new Date().toISOString() });
    writeState({ ...readState(), offset });
    console.log(`✓ Saved in ${configPath()}, readable by you only.`);
    await call('sendMessage', { chat_id: chat.id, text: `${t('bot.connected')}\n\n${t('bot.help')}` });
    return 0;
  } finally {
    rl.close();
  }
}

export function off() {
  stopListener();
  rmSync(configPath(), { force: true });
  rmSync(outboxPath(), { force: true });
  console.log('✓ The Telegram bridge is off: the token is deleted. The watchdog job keeps checking for missed heartbeats; `jerome watchdog uninstall` removes it.');
  return 0;
}

export function telegramStatus() {
  const c = readConfig();
  if (!c) {
    console.log('Telegram: not set up. `jerome telegram setup` connects a bot.');
    return 0;
  }
  const queued = existsSync(outboxPath()) ? readFileSync(outboxPath(), 'utf8').split('\n').filter(Boolean).length : 0;
  console.log(`Telegram: @${c.bot}, heard only from ${c.chat} · ${listenerRunning() ? 'listening' : 'not listening: the watchdog starts the listener within a minute'} · ${queued} ${queued === 1 ? 'message' : 'messages'} waiting to be sent · token in ${configPath()}`);
  return 0;
}

export async function telegramTest({ env = process.env } = {}) {
  const c = readConfig();
  if (!c) {
    console.error('Telegram is not set up: `jerome telegram setup`.');
    return 1;
  }
  try {
    await telegramApi(c.token, env)('sendMessage', { chat_id: c.chatId, text: t('bot.test') });
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  console.log('✓ Sent.');
  return 0;
}

// The listener (D184): the bridge always listening, so a tap or a reply is answered in a second or two rather than at
// the watchdog's next pass, which first does everything else. One at a time, by its pid file; the watchdog starts it
// when none runs. It ends after LISTENER_MS, or as soon as Jérôme was updated, so the next one runs the new code.
const listenerPid = () => join(dataDir(), 'listener.pid');
const PACKAGE_FILE = join(dirname(BIN), '..', 'package.json');

export function listenerRunning() {
  try {
    process.kill(Number(readFileSync(listenerPid(), 'utf8')), 0);
    return true;
  } catch {
    return false;
  }
}

// Starts the listener apart, its lines in the watchdog's log, when the bridge is set up and none runs. True when
// started.
export function startListener(env = process.env) {
  if (!readConfig() || listenerRunning()) return false;
  const log = cacheDir('logs', 'watchdog.log');
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, 'a');
  const child = spawn(process.execPath, [BIN, 'telegram', 'listen'], { env, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  closeSync(fd);
  return true;
}

function installedVersion() {
  try {
    return JSON.parse(readFileSync(PACKAGE_FILE, 'utf8')).version;
  } catch {
    return null;
  }
}

export async function listen({ env = process.env, maxMs = LISTENER_MS } = {}) {
  if (listenerRunning()) return 0;
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(listenerPid(), String(process.pid));
  const end = Date.now() + maxMs;
  try {
    while (Date.now() < end && installedVersion() === VERSION) {
      const done = await bridgeTick({ env, now: new Date(), until: Math.min(end, Date.now() + 60_000) });
      if (!done.configured) break;
      if (done.received || done.sent || done.ignored || done.errors.length) {
        console.log(`${new Date().toISOString()} telegram: ${done.received} received, ${done.sent} sent${done.ignored ? `, ${done.ignored} from other chats ignored` : ''}${done.errors.length ? `; errors: ${done.errors.join('; ')}` : ''}`);
      }
      // Telegram unreachable: a pause, not a loop of failing calls; else a breath between two passes.
      await new Promise((r) => setTimeout(r, done.errors.length ? 10_000 : 10));
    }
    return 0;
  } finally {
    try {
      if (readFileSync(listenerPid(), 'utf8') === String(process.pid)) rmSync(listenerPid(), { force: true });
    } catch {
      // Already gone.
    }
  }
}

// Stops the listener, for `jerome telegram off`.
function stopListener() {
  try {
    process.kill(Number(readFileSync(listenerPid(), 'utf8')), 'SIGTERM');
  } catch {
    // None runs.
  }
  rmSync(listenerPid(), { force: true });
}
