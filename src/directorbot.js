// Jérôme Director, step 5 (D155, D202): the Telegram bot on the Director, one for every project of every Mac, since
// one bot is polled by one machine only. Out: what each Mac queued, sent with its beat (a request with its options, a
// block with its actions, a push question, a notification). In: a tap, a reply, a note or /status, each turned into
// the same order the dashboard places (D191), which the Mac takes with its next beat, checks under its own rules and
// runs; its result is told back here. The bot runs nothing, holds no Mac's credential, and its token stays on the
// server, in a file only the Director's user can read.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { telegramApi, sendItem, setup as telegramSetup } from './telegram.js';
import { t } from './i18n.js';
import { optionList } from './options.js';
import { actionsFor } from './unblock.js';
import { blockMessage, howLong } from './blocks.js';
import { placeOrder, spokenLanguage } from './dashboard.js';
import { scrub } from './scrub.js';

// The longest a poll of Telegram waits for an update: what a beat brought waits at most this long too.
const POLL_SECONDS = 10;
// A message Telegram keeps refusing is dropped after this long.
const OUTBOX_MS = 2 * 86_400_000;
// A message about the account (the quota running fast) comes from each Mac that watches it: told once in this time.
const ACCOUNT_MS = 20 * 3_600_000;
const MAX_TEXT = 4000;

export const botConfigPath = (home) => join(home, 'telegram.json');

export function readBotConfig(home) {
  try {
    const c = JSON.parse(readFileSync(botConfigPath(home), 'utf8'));
    return c.token && c.chatId ? c : null;
  } catch {
    return null;
  }
}

export function createBotTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS tg_outbox (id INTEGER PRIMARY KEY, machine TEXT, project TEXT, data TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tg_sent (message_id INTEGER PRIMARY KEY, machine TEXT, project TEXT, request INTEGER, alert INTEGER, push TEXT,
      buttons INTEGER NOT NULL DEFAULT 0, cleared INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tg_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  // Which way an order came, and whether its result was told on Telegram (D202).
  const columns = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!columns.includes('via')) db.exec('ALTER TABLE orders ADD COLUMN via TEXT');
  if (!columns.includes('told')) db.exec('ALTER TABLE orders ADD COLUMN told TEXT');
}

const getState = (db, key, fallback) => {
  const r = db.prepare('SELECT value FROM tg_state WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : fallback;
};
const setState = (db, key, value) => db.prepare('INSERT OR REPLACE INTO tg_state (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));

// What a Mac's beat brought for Telegram, kept until sent. Only while the bot is set up: a Mac sends them only then.
export function takeMessages(db, home, machine, messages, at) {
  if (!messages?.length || !readBotConfig(home)) return;
  for (const m of messages) {
    if (!m.project) {
      const last = getState(db, 'account', null);
      if (last && Date.parse(at) - Date.parse(last) < ACCOUNT_MS) continue;
      setState(db, 'account', at);
    }
    db.prepare('INSERT INTO tg_outbox (machine, project, data, at) VALUES (?, ?, ?, ?)').run(machine, m.project ?? null, JSON.stringify(m), at);
  }
}

// Every project the Director knows, of every approved Mac, named with its Mac when two share a name.
function allProjects(db) {
  const rows = db.prepare("SELECT p.machine, p.key, p.name, p.data, m.name machine_name FROM projects p JOIN machines m ON m.id = p.machine WHERE m.status = 'approved' ORDER BY p.name, m.name").all();
  return rows.map((r) => ({ machine: r.machine, key: r.key, name: rows.filter((x) => x.name === r.name).length > 1 ? `${r.name} (${r.machine_name})` : r.name,
    machineName: r.machine_name, data: JSON.parse(r.data) }));
}

const clip = (text) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);

// One pass: the updates, the results to tell, the buttons to take off, then what waits to be sent. `wait` is how long
// Telegram may hold the poll open for an update.
export async function botPass({ db, home, env = process.env, wait = 0, now = () => new Date() }) {
  const config = readBotConfig(home);
  if (!config) return { configured: false };
  const call = telegramApi(config.token, env);
  const code = spokenLanguage(db);
  const say = (key, values = {}) => t(key, values, code);
  const reply = (text, extra = {}) => call('sendMessage', { chat_id: config.chatId, text: clip(text), ...extra });
  const done = { configured: true, received: 0, ignored: 0, sent: 0, errors: [] };
  const ctx = { db, call, config, say, reply, now, code };
  try {
    const updates = await call('getUpdates', { offset: getState(db, 'offset', 0), timeout: wait, allowed_updates: ['message', 'callback_query'] });
    for (const u of updates) {
      setState(db, 'offset', Math.max(getState(db, 'offset', 0), u.update_id + 1));
      const chat = u.message?.chat ?? u.callback_query?.message?.chat;
      // Only the user's own private chat is heard; anything else is counted and dropped, unread.
      if (!chat || chat.type !== 'private' || String(chat.id) !== String(config.chatId)) {
        done.ignored += 1;
        continue;
      }
      done.received += 1;
      try {
        if (u.callback_query) await onButton(u.callback_query, ctx);
        else if (typeof u.message.text === 'string') await onMessage(u.message, ctx);
      } catch (err) {
        done.errors.push(err.message);
      }
    }
  } catch (err) {
    done.errors.push(err.message);
  }
  for (const step of [tellResults, syncButtons, (c) => sendQueue(c, done)]) {
    try {
      await step(ctx);
    } catch (err) {
      done.errors.push(err.message);
    }
  }
  return done;
}

// The bot, for as long as the Director serves: a pass after another, long polling Telegram so a tap is heard at once.
export async function runBot({ db, home, env = process.env, log = () => {} }) {
  for (let wait = 0; ; wait = POLL_SECONDS) {
    let done;
    try {
      done = await botPass({ db, home, env, wait });
    } catch (err) {
      done = { configured: true, errors: [err.message] };
    }
    if (!done.configured) {
      await new Promise((r) => setTimeout(r, 10_000));
      continue;
    }
    if (done.received || done.sent || done.ignored || done.errors.length) {
      log(`telegram: ${done.received ?? 0} received, ${done.sent ?? 0} sent${done.ignored ? `, ${done.ignored} from other chats ignored` : ''}${done.errors.length ? `; errors: ${done.errors.join('; ')}` : ''}`);
    }
    // Telegram refusing or unreachable: a pause, not a loop of failing calls; a call that only hung goes again at once.
    await new Promise((r) => setTimeout(r, done.errors.some((e) => !/aborted due to timeout/.test(e)) ? 10_000 : 10));
  }
}

// An order placed from Telegram: told as sent to its Mac, or why not. True when placed.
async function order(ctx, p, o) {
  const r = placeOrder(ctx.db, { machine: p.machine, project: p.key, ...o }, { now: ctx.now(), via: 'telegram' });
  await ctx.reply(r.status === 201 ? ctx.say('dbot.sent', { project: p.name, machine: p.machineName }) : ctx.say('dbot.refused', { project: p.name, error: r.body.error }));
  return r.status === 201;
}

const findProject = (db, machine, key) => allProjects(db).find((p) => p.machine === machine && p.key === key) ?? null;

async function clear(ctx, messageId) {
  try {
    await ctx.call('editMessageReplyMarkup', { chat_id: ctx.config.chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  } catch {
    // Too old to edit: a tap on it finds the question closed.
  }
  ctx.db.prepare('UPDATE tg_sent SET cleared = 1 WHERE message_id = ?').run(messageId);
}

async function onButton(q, ctx) {
  const [kind, a, b] = String(q.data ?? '').split(':');
  try {
    await ctx.call('answerCallbackQuery', { callback_query_id: q.id });
  } catch {
    // Too late to stop the spinner.
  }
  const id = q.message?.message_id;
  const about = ctx.db.prepare('SELECT * FROM tg_sent WHERE message_id = ?').get(id);
  // The project chosen for a note that named none.
  if (kind === 'n') {
    const pending = getState(ctx.db, 'pending', {});
    const waiting = pending[a];
    delete pending[a];
    setState(ctx.db, 'pending', pending);
    const choice = waiting?.choices?.[Number(b)];
    const p = choice ? findProject(ctx.db, choice[0], choice[1]) : null;
    if (!waiting || !p) return ctx.reply(ctx.say('note.expired'));
    return order(ctx, p, { kind: 'note', text: waiting.text });
  }
  const p = about ? findProject(ctx.db, about.machine, about.project) : null;
  // A button of a message the Director did not send, such as a Mac's bridge's before the move.
  if (!p) return ctx.reply(ctx.say('dbot.old'));
  let placed = false;
  if (kind === 'a' && about.request === Number(a)) placed = await order(ctx, p, { kind: 'answer', ref: Number(a), choice: Number(b) });
  else if (kind === 'x' && about.alert === Number(a)) placed = await order(ctx, p, { kind: 'action', ref: Number(a), action: b });
  else if (kind === 'p' && about.push === a) placed = await order(ctx, p, { kind: 'push', head: a, action: b });
  else return ctx.reply(ctx.say('dbot.old'));
  if (placed) await clear(ctx, id);
  return null;
}

async function onMessage(m, ctx) {
  const text = m.text.trim();
  const command = text.match(/^\/(\w+)/)?.[1]?.toLowerCase();
  if (command === 'status') return status(ctx);
  if (command === 'start' || command === 'help') return ctx.reply(ctx.say('dbot.help'));
  if (command) return ctx.reply(`${ctx.say('bot.unknown')}\n\n${ctx.say('dbot.help')}`);
  const about = m.reply_to_message ? ctx.db.prepare('SELECT * FROM tg_sent WHERE message_id = ?').get(m.reply_to_message.message_id) : null;
  const p = about ? findProject(ctx.db, about.machine, about.project) : null;
  if (p && about.request) {
    if (await order(ctx, p, { kind: 'answer', ref: about.request, text })) await clear(ctx, about.message_id);
    return null;
  }
  if (p) return order(ctx, p, { kind: 'note', text });
  const projects = allProjects(ctx.db);
  const tag = text.match(/^#([\w.-]+)\s+([\s\S]+)$/);
  const named = tag ? projects.filter((x) => x.data.name.toLowerCase() === tag[1].toLowerCase()) : projects;
  const body = tag ? tag[2].trim() : text;
  if (tag && !named.length) return ctx.reply(ctx.say('dbot.unknown', { name: tag[1], list: [...new Set(projects.map((x) => x.name))].join(', ') || '—' }));
  if (!named.length) return ctx.reply(ctx.say('dbot.none'));
  if (named.length === 1) return order(ctx, named[0], { kind: 'note', text: body });
  // Which project: asked with a button each; the text waits in the bot's state meanwhile.
  const key = String(m.message_id);
  const pending = getState(ctx.db, 'pending', {});
  pending[key] = { text: body, choices: named.map((x) => [x.machine, x.key]), at: ctx.now().toISOString() };
  // Notes not placed within a day are forgotten.
  for (const [k, v] of Object.entries(pending)) if (Date.parse(v.at) < ctx.now().getTime() - 86_400_000) delete pending[k];
  setState(ctx.db, 'pending', pending);
  return ctx.reply(ctx.say('note.which'), { reply_markup: { inline_keyboard: named.map((x, i) => [{ text: x.name, callback_data: `n:${key}:${i}` }]) } });
}

// /status, from what every Mac said: the open requests and the blocks of each project, the quota, then each block
// that has actions as a message of its own with its buttons (D168).
async function status(ctx) {
  const now = ctx.now();
  // What was answered or acted on lately, here or on the dashboard, is left out before its Mac's beat says so (D191).
  const handled = new Set(ctx.db.prepare("SELECT machine, project, kind, ref FROM orders WHERE status IN ('pending', 'done') AND ref IS NOT NULL AND created_at > ?")
    .all(new Date(now.getTime() - 15 * 60_000).toISOString()).map((o) => `${o.machine}/${o.project}/${o.kind}/${o.ref}`));
  const projects = allProjects(ctx.db).map((x) => ({ ...x, data: { ...x.data,
    requests: (x.data.requests ?? []).filter((r) => !handled.has(`${x.machine}/${x.key}/answer/${r.id}`)),
    alerts: (x.data.alerts ?? []).filter((a) => !handled.has(`${x.machine}/${x.key}/action/${a.id}`)) } }));
  const blocks = (x) => x.data.alerts.map((a) => ({ ...a, reason: scrub(a.reason), count: a.count ?? 1, openedAt: a.openedAt ?? now.toISOString() }));
  const waiting = projects.filter((x) => x.data.requests.length || x.data.alerts.length);
  const r = ctx.db.prepare('SELECT data FROM readings ORDER BY read_at DESC LIMIT 1').get();
  const windows = r ? JSON.parse(r.data).windows ?? {} : {};
  const live = (w) => (w && (w.resetsAt ?? 0) * 1000 > now.getTime() ? w.used : null);
  const quota = live(windows.seven_day) !== null ? `\n\n${ctx.say('status.quota', { seven: live(windows.seven_day), five: live(windows.five_hour) })}` : '';
  const text = waiting.length
    ? waiting.map((x) => `${x.name}\n${[...(x.data.requests ?? []).map((q) => ctx.say('status.request', { id: q.id, question: scrub(q.question) })),
      ...blocks(x).map((a) => `⚠ ${blockMessage(a.reason, ctx.code)} ${howLong(a, now, ctx.code)}`)].join('\n')}`).join('\n\n')
    : ctx.say('status.nothing', { n: projects.length });
  await ctx.reply(`${text}${quota}`);
  for (const x of waiting) {
    for (const a of blocks(x)) {
      const actions = actionsFor(a.reason);
      if (actions.length) await deliver(ctx, { machine: x.machine, project: x.key, name: x.name, item: { text: `⚠ ${blockMessage(a.reason, ctx.code)} ${howLong(a, now, ctx.code)}`, alert: { id: a.id, actions } } });
    }
  }
}

// One message to the user, remembered so a tap or a reply on it reaches its project.
async function deliver(ctx, { machine, project, name, item }) {
  const { message, actions, push, keyboard } = await sendItem({ ...item, project: name }, ctx.call, ctx.config.chatId, ctx.code);
  ctx.db.prepare('INSERT OR REPLACE INTO tg_sent (message_id, machine, project, request, alert, push, buttons, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(message.message_id, machine, project, item.request?.id ?? null, actions.length ? item.alert.id : null, push?.head ?? null, keyboard.length ? 1 : 0, ctx.now().toISOString());
  // Kept for the last 1,000 messages.
  ctx.db.prepare('DELETE FROM tg_sent WHERE message_id NOT IN (SELECT message_id FROM tg_sent ORDER BY message_id DESC LIMIT 1000)').run();
}

async function sendQueue(ctx, done) {
  for (const row of ctx.db.prepare('SELECT * FROM tg_outbox ORDER BY id LIMIT 50').all()) {
    const item = JSON.parse(row.data);
    const p = row.project ? findProject(ctx.db, row.machine, row.project) : null;
    try {
      await deliver(ctx, { machine: row.machine, project: row.project, name: p?.name ?? (row.project ? row.project.replace(/-[0-9a-f]{12}$/, '') : 'Jérôme'), item });
      ctx.db.prepare('DELETE FROM tg_outbox WHERE id = ?').run(row.id);
      done.sent += 1;
    } catch (err) {
      done.errors.push(err.message);
      if (ctx.now().getTime() - Date.parse(row.at) > OUTBOX_MS) ctx.db.prepare('DELETE FROM tg_outbox WHERE id = ?').run(row.id);
    }
  }
}

// What the Macs did with the orders given on Telegram: their own words, or that the Mac never took it.
async function tellResults(ctx) {
  for (const o of ctx.db.prepare("SELECT o.*, m.name machine_name FROM orders o JOIN machines m ON m.id = o.machine WHERE o.via = 'telegram' AND o.status != 'pending' AND o.told IS NULL ORDER BY o.id").all()) {
    const p = findProject(ctx.db, o.machine, o.project);
    await ctx.reply(o.status === 'lapsed' ? ctx.say('dbot.lapsed', { project: p?.name ?? o.project }) : scrub(o.result ?? ''));
    ctx.db.prepare('UPDATE orders SET told = ? WHERE id = ?').run(ctx.now().toISOString(), o.id);
  }
}

// A request's, block's or push's buttons go once it is closed anywhere, so no tap goes to what is not open any more.
async function syncButtons(ctx) {
  for (const s of ctx.db.prepare('SELECT * FROM tg_sent WHERE buttons = 1 AND cleared = 0').all()) {
    const data = findProject(ctx.db, s.machine, s.project)?.data;
    const open = data && (s.request !== null ? (data.requests ?? []).some((r) => r.id === s.request)
      : s.alert !== null ? (data.alerts ?? []).some((a) => a.id === s.alert)
        : s.push !== null ? data.rules?.push?.head === s.push : true);
    if (!open) await clear(ctx, s.message_id);
  }
}

// `jerome director telegram setup | status | test | off`, on the server.
export async function botCommand(action, { home, env = process.env, db } = {}) {
  if (action === 'setup') {
    return telegramSetup({ env, where: 'the Director', helpKey: 'dbot', save: (config, offset) => {
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeFileSync(botConfigPath(home), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
      chmodSync(botConfigPath(home), 0o600);
      setState(db, 'offset', offset);
      return botConfigPath(home);
    } });
  }
  const config = readBotConfig(home);
  if (action === 'off') {
    rmSync(botConfigPath(home), { force: true });
    db.prepare('DELETE FROM tg_outbox').run();
    console.log('✓ Telegram is off on the Director: the token is deleted. At their next beat the Macs\' own bridges, where set up, speak again.');
    return 0;
  }
  if (!config) {
    console.log('Telegram: not set up on the Director. `jerome director telegram setup` connects a bot; the Macs\' own bridges stop at their next beat.');
    return action === 'status' ? 0 : 1;
  }
  if (action === 'test') {
    try {
      await telegramApi(config.token, env)('sendMessage', { chat_id: config.chatId, text: t('dbot.test', {}, spokenLanguage(db)) });
    } catch (err) {
      console.error(err.message);
      return 1;
    }
    console.log('✓ Sent.');
    return 0;
  }
  const queued = db.prepare('SELECT count(*) n FROM tg_outbox').get().n;
  console.log(`Telegram: @${config.bot}, heard only from ${config.chat} · for every Mac's projects · ${queued} ${queued === 1 ? 'message' : 'messages'} waiting to be sent · token in ${botConfigPath(home)}`);
  return 0;
}

