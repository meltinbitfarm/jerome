// The user's language (D162): what Jérôme writes to the user (notifications, Telegram, the decision requests the
// lead agent opens) is in it; files, digest and docs stay in English. It is, in order: JEROME_LANGUAGE, the one set
// with `jerome language <code>` (~/.config/jerome/preferences.json), the system's (macOS's first preferred language,
// LANG elsewhere), English. A language Jérôme has no texts for falls back to English.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const LANGUAGES = { en: 'English', it: 'Italiano' };
// The names the lead agent's prompt, in English, gives them.
const ENGLISH_NAMES = { en: 'English', it: 'Italian' };

// The lead agent's line on the user's language, for its prompt: null in English.
export function leadLanguageLine(code = lang()) {
  return code === 'en' ? null : `Write decision requests (question, options, recommendation) in ${ENGLISH_NAMES[code]}, the user's language; files, commits and the digest stay in English.`;
}

function preferencesPath(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'jerome', 'preferences.json');
}

function readPreferences(env) {
  try {
    return JSON.parse(readFileSync(preferencesPath(env), 'utf8'));
  } catch {
    return {};
  }
}

// The system's language, as a two-letter code, or null.
export function systemLanguage(env = process.env) {
  if (process.platform === 'darwin') {
    const r = spawnSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8', timeout: 3000 });
    const first = r.status === 0 ? r.stdout.match(/"?([a-z]{2,3})[-_"\n]/i) : null;
    if (first) return first[1].toLowerCase();
  }
  const lang = env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  const m = lang.match(/^([a-z]{2,3})(?:[_.-]|$)/i);
  return m && !/^(c|posix)$/i.test(m[1]) ? m[1].toLowerCase() : null;
}

// { code, source }: the language used, and where it came from.
export function userLanguage(env = process.env) {
  const pick = (code, source) => (code && LANGUAGES[code] ? { code, source } : null);
  return pick(env.JEROME_LANGUAGE, 'JEROME_LANGUAGE')
    ?? pick(readPreferences(env).language, 'jerome language')
    ?? pick(systemLanguage(env), 'system')
    ?? { code: 'en', source: 'default' };
}

export const lang = (env = process.env) => userLanguage(env).code;

export function setLanguage(code, env = process.env) {
  const path = preferencesPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const prefs = readPreferences(env);
  if (code) prefs.language = code;
  else delete prefs.language;
  writeFileSync(path, `${JSON.stringify(prefs, null, 2)}\n`);
}

// `jerome language [code|auto]`.
export async function language(code = null, { env = process.env } = {}) {
  if (code === null) {
    const u = userLanguage(env);
    const from = { 'jerome language': 'set with `jerome language`', system: 'the system\'s', JEROME_LANGUAGE: 'from JEROME_LANGUAGE', default: 'the default' };
    console.log(`${u.code} (${LANGUAGES[u.code]}), ${from[u.source]}. Available: ${Object.keys(LANGUAGES).join(', ')}; \`jerome language auto\` follows the system.`);
    return 0;
  }
  const wanted = code.toLowerCase();
  if (wanted !== 'auto' && !LANGUAGES[wanted]) {
    console.error(`Jérôme has no texts in "${code}" yet: ${Object.entries(LANGUAGES).map(([k, v]) => `${k} (${v})`).join(', ')}, or auto.`);
    return 2;
  }
  setLanguage(wanted === 'auto' ? null : wanted, env);
  const u = userLanguage(env);
  console.log(`✓ Jérôme writes to you in ${LANGUAGES[u.code]}: notifications, Telegram and the decision requests of the next runs.`);
  return 0;
}

// The texts, by language. A function takes the values it needs; a missing key in a language falls back to English.
const TEXTS = {
  en: {
    'block.untrusted': 'Claude Code does not trust the project\'s folder yet, so it cannot work there. Open `claude` in the folder once and accept.',
    'block.provisional': 'The briefing is not finished. Open a session in the project and confirm it.',
    'block.nogit': 'The project has no first commit yet. Make one, and it starts by itself.',
    'block.yours': ({ files }) => `There are changes of yours not committed (${files}). Commit or discard them, and it starts by itself.`,
    'block.branch': ({ branch }) => `The folder is on the branch ${branch}, not the main one. Switch back, and it starts by itself.`,
    'block.detached': 'The repository is on no branch (a detached HEAD). Switch back to the main branch.',
    'block.operation': ({ op }) => `A git ${op} was left half done. Finish it or abort it.`,
    'block.doctor': 'Jérôme\'s setup in the project is broken. Run `jerome doctor` in the folder.',
    'block.slot': 'A scheduled time no longer exists. Run `jerome heartbeat install` in the project.',
    'block.commit': 'Jérôme cannot commit its own files. Open a session to see why.',
    'block.denied': 'It stopped on something only you can do, such as a push or a deploy. Open a session to see what it needed.',
    'block.triage': 'The quick check before each run keeps failing. Open a session to see why.',
    'block.cap': 'It keeps stopping at its budget on the same work: the task may be too big. Open a session to split it, or raise its budget.',
    'block.duration': 'Its runs keep reaching their maximum duration. Open a session to see what is slow.',
    'block.lost': 'Its runs end without finishing, as when the Mac sleeps or restarts in the middle. If it goes on, open a session.',
    'block.missed': 'Its scheduled runs do not start, as when the Mac is off or asleep. Check that the Mac stays on.',
    'block.endcheck': 'It cannot finish its work cleanly: the last runs left it half done. Open a session and ask Jérôme what is stuck.',
    'block.other': 'Its runs keep stopping. Open a session and ask Jérôme what is wrong.',
    'action.commit': 'Commit them',
    'action.stash': 'Set them aside',
    'action.budget': 'Twice the budget, one run',
    'action.skip': 'Skip it, go on',
    'action.did': 'Done, I did it',
    'action.main': 'Back to the main branch',
    'action.retry': 'Try again now',
    'acted.commit': ({ files }) => `Committed (${files}). The next run starts from there.`,
    'acted.stash': ({ files }) => `Set aside (${files}): \`git stash list\` in the project finds them. The next run starts clean.`,
    'acted.budget': 'A run with twice the budget starts now.',
    'acted.skip': 'Done: the next run leaves that work and takes another.',
    'acted.did': 'Noted: the next run goes on from there.',
    'acted.main': ({ branch }) => `Back on ${branch}; the work stays on its own branch.`,
    'acted.retry': 'A run starts now.',
    'acted.gone': 'That block is already closed: nothing to do.',
    'acted.busy': 'A run is going on: try again when it ends.',
    'acted.dirty': 'There are uncommitted changes: commit them or set them aside first.',
    'acted.nothing': 'Nothing was left to commit: the block is closed.',
    'acted.failed': ({ error }) => `It did not work: ${error}`,
    'block.since': ({ time, runs }) => `Stuck for ${time}, ${runs} ${runs === 1 ? 'run' : 'runs'} lost.`,
    'time.days': ({ n }) => `${n} days`,
    'time.hours': ({ n }) => `${n} h`,
    'time.short': 'less than an hour',
    'request.notice': ({ id, question }) => `Decision request R${id}: ${question}`,
    'request.options': 'Options',
    'request.recommended': 'Recommended',
    'request.how': 'Tap an option, or reply to this message with your answer.',
    'request.answered': ({ project, id, text }) => `${project}: R${id} answered: ${text}`,
    'request.failed': ({ project, id, error }) => `${project}: R${id} could not be answered: ${error}`,
    'request.gone': ({ project, id }) => `${project}: R${id} is not there any more.`,
    'request.closed': ({ project, id, status }) => `${project}: R${id} is already ${status}; nothing changed.`,
    'note.which': 'Which project is this note for?',
    'note.expired': 'That note is no longer waiting: send it again.',
    'note.unknown': ({ name, list }) => `There is no project called ${name} on this machine: ${list}.`,
    'note.none': 'There is no Jérôme project on this machine.',
    'note.nodb': ({ project }) => `${project}: the project database is missing, so the note was not saved.`,
    'note.saved': ({ project, id }) => `${project}: note N${id} saved. The next heartbeat's triage reads it, and so does your next session.`,
    'bot.help': 'I am Jérôme\'s bridge on this machine.\n• Reply to a decision request, or tap an option, to answer it.\n• Reply to any other message of a project, or start with #project, to leave that project a note; the next heartbeat reads it.\n• /status: what waits for you, in every project.\nI run nothing else.',
    'bot.unknown': 'I only know /status and /help.',
    'bot.connected': 'Jérôme is connected on this machine. You will get here what waits for you, from every project.',
    'bot.test': 'Jérôme: test message from this machine.',
    'status.noanswer': 'jerome projects did not answer.',
    'status.nothing': ({ n }) => `Nothing waits for you in ${n} ${n === 1 ? 'project' : 'projects'}: everything else goes on by itself.`,
    'status.request': ({ id, question }) => `❓ R${id} ${question}`,
    'status.quota': ({ seven, five }) => `Quota: week ${seven}%${five !== null ? `, 5 hours ${five}%` : ''}.`,
    'quota.burn': ({ rise, from, to, pace }) => `The weekly quota is running fast: +${rise} points in the last 24 hours (from ${from}% to ${to}%), against about ${pace} a day to keep pace.`,
    'quota.out': ({ day }) => ` At this speed it runs out ${day}, before the reset.`,
    'quota.reset': ({ day }) => ` The reset is ${day}.`,
  },
  it: {
    'block.untrusted': 'Claude Code non si fida ancora della cartella del progetto, quindi lì non può lavorare. Apri `claude` nella cartella una volta e accetta.',
    'block.provisional': 'Il briefing non è finito. Apri una sessione nel progetto e confermalo.',
    'block.nogit': 'Il progetto non ha ancora un primo commit. Fallo tu, e riparte da solo.',
    'block.yours': ({ files }) => `Ci sono modifiche tue non salvate (${files}). Fai il commit o scartale, e riparte da solo.`,
    'block.branch': ({ branch }) => `La cartella è sul ramo ${branch}, non su quello principale. Torna sul principale, e riparte da solo.`,
    'block.detached': 'Il repository non è su nessun ramo (detached HEAD). Torna sul ramo principale.',
    'block.operation': ({ op }) => `Un ${op} di git è rimasto a metà. Finiscilo o annullalo.`,
    'block.doctor': 'L\'installazione di Jérôme nel progetto è rotta. Lancia `jerome doctor` nella cartella.',
    'block.slot': 'Un orario programmato non esiste più. Lancia `jerome heartbeat install` nel progetto.',
    'block.commit': 'Jérôme non riesce a fare il commit dei suoi file. Apri una sessione per vedere perché.',
    'block.denied': 'Si è fermato su qualcosa che puoi fare solo tu, come un push o un deploy. Apri una sessione per vedere cosa gli serviva.',
    'block.triage': 'Il controllo veloce prima di ogni run continua a fallire. Apri una sessione per vedere perché.',
    'block.cap': 'Si ferma sempre al suo budget sullo stesso lavoro: forse il compito è troppo grande. Apri una sessione per dividerlo, o alza il budget.',
    'block.duration': 'Le sue run arrivano sempre alla durata massima. Apri una sessione per vedere cosa è lento.',
    'block.lost': 'Le sue run finiscono senza chiudersi, come quando il Mac va in stop o si riavvia a metà. Se continua, apri una sessione.',
    'block.missed': 'Le run programmate non partono, come quando il Mac è spento o in stop. Controlla che il Mac resti acceso.',
    'block.endcheck': 'Non riesce a chiudere il lavoro in modo pulito: le ultime run l\'hanno lasciato a metà. Apri una sessione e chiedi a Jérôme dove si è bloccato.',
    'block.other': 'Le sue run continuano a fermarsi. Apri una sessione e chiedi a Jérôme cosa non va.',
    'action.commit': 'Fai il commit',
    'action.stash': 'Mettile da parte',
    'action.budget': 'Budget doppio, una run',
    'action.skip': 'Salta e vai avanti',
    'action.did': "Fatto, l'ho fatto io",
    'action.main': 'Torna sul branch principale',
    'action.retry': 'Riprova adesso',
    'acted.commit': ({ files }) => `Commit fatto (${files}). La prossima run parte da lì.`,
    'acted.stash': ({ files }) => `Messe da parte (${files}): le ritrovi con \`git stash list\` nel progetto. La prossima run parte pulita.`,
    'acted.budget': 'Parte adesso una run con il budget doppio.',
    'acted.skip': 'Fatto: la prossima run lascia quel lavoro e ne prende un altro.',
    'acted.did': 'Segnato: la prossima run va avanti da lì.',
    'acted.main': ({ branch }) => `Di nuovo su ${branch}; il lavoro resta sul suo branch.`,
    'acted.retry': 'Parte adesso una run.',
    'acted.gone': 'Quel blocco è già chiuso: non c\'è niente da fare.',
    'acted.busy': 'C\'è una run in corso: riprova quando finisce.',
    'acted.dirty': 'Ci sono modifiche non salvate: prima fai il commit o mettile da parte.',
    'acted.nothing': 'Non restava niente da salvare: il blocco è chiuso.',
    'acted.failed': ({ error }) => `Non ha funzionato: ${error}`,
    'block.since': ({ time, runs }) => `Fermo da ${time}, ${runs} ${runs === 1 ? 'run persa' : 'run perse'}.`,
    'time.days': ({ n }) => `${n} giorni`,
    'time.hours': ({ n }) => (n === 1 ? 'un\'ora' : `${n} ore`),
    'time.short': 'meno di un\'ora',
    'request.notice': ({ id, question }) => `Domanda R${id}: ${question}`,
    'request.options': 'Opzioni',
    'request.recommended': 'Consiglio',
    'request.how': 'Tocca un\'opzione, o rispondi a questo messaggio.',
    'request.answered': ({ project, id, text }) => `${project}: R${id} risposta: ${text}`,
    'request.failed': ({ project, id, error }) => `${project}: non sono riuscito a rispondere a R${id}: ${error}`,
    'request.gone': ({ project, id }) => `${project}: R${id} non c'è più.`,
    'request.closed': ({ project, id, status }) => `${project}: R${id} è già chiusa (${status}); non ho cambiato niente.`,
    'note.which': 'Per quale progetto è questa nota?',
    'note.expired': 'Quella nota non è più in attesa: mandala di nuovo.',
    'note.unknown': ({ name, list }) => `Su questo Mac non c'è un progetto ${name}: ${list}.`,
    'note.none': 'Su questo Mac non c\'è nessun progetto Jérôme.',
    'note.nodb': ({ project }) => `${project}: manca il database del progetto, quindi la nota non è stata salvata.`,
    'note.saved': ({ project, id }) => `${project}: nota N${id} salvata. La legge il prossimo heartbeat, e anche la tua prossima sessione.`,
    'bot.help': 'Sono il ponte di Jérôme su questo Mac.\n• Rispondi a una domanda, o tocca un\'opzione, per rispondere.\n• Rispondi a un altro messaggio di un progetto, o inizia con #progetto, per lasciargli una nota; la legge il prossimo heartbeat.\n• /status: cosa ti aspetta, in tutti i progetti.\nNon eseguo nient\'altro.',
    'bot.unknown': 'Conosco solo /status e /help.',
    'bot.connected': 'Jérôme è collegato su questo Mac. Qui ti arriva quello che ti aspetta, da tutti i progetti.',
    'bot.test': 'Jérôme: messaggio di prova da questo Mac.',
    'status.noanswer': 'jerome projects non ha risposto.',
    'status.nothing': ({ n }) => `Niente ti aspetta in ${n} ${n === 1 ? 'progetto' : 'progetti'}: tutto il resto va avanti da solo.`,
    'status.request': ({ id, question }) => `❓ R${id} ${question}`,
    'status.quota': ({ seven, five }) => `Quota: settimana ${seven}%${five !== null ? `, 5 ore ${five}%` : ''}.`,
    'quota.burn': ({ rise, from, to, pace }) => `La quota settimanale sta correndo: +${rise} punti nelle ultime 24 ore (dal ${from}% al ${to}%), contro circa ${pace} al giorno per stare al passo.`,
    'quota.out': ({ day }) => ` A questa velocità finisce ${day}, prima del reset.`,
    'quota.reset': ({ day }) => ` Il reset è ${day}.`,
  },
};

// The text for a key in the user's language.
export function t(key, values = {}, code = lang()) {
  const text = TEXTS[code]?.[key] ?? TEXTS.en[key];
  if (text === undefined) throw new Error(`no text for ${key}`);
  return typeof text === 'function' ? text(values) : text;
}

// A day as people say it, in the user's language: "on Friday" / "venerdì".
export function dayName(date, code = lang()) {
  const day = date.toLocaleDateString(code === 'it' ? 'it-IT' : 'en-GB', { weekday: 'long' });
  return code === 'it' ? day : `on ${day}`;
}

