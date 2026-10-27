// The check behind the PreToolUse hook (D49, D61): a Bash command that chains a git command changing the
// repository with anything else is refused, so the lead agent runs those one per call and checks each result; so is
// one that stages everything changed instead of named paths (D125).
// Chained reads stay allowed. The split is best effort: quotes, heredocs, $(…) and backticks are opaque, and
// commands inside `bash -c '…'` or scripts are not inspected.

// Splits a command on &&, ||, ;, |, |&, & and newlines, outside quotes, heredoc bodies, $(…) and backticks.
export function splitCommand(command) {
  const segments = [];
  let current = '';
  const heredocs = [];
  let i = 0;
  const push = () => {
    if (current.trim()) segments.push(current.trim());
    current = '';
  };
  while (i < command.length) {
    const c = command[i];
    const next = command[i + 1];
    if (c === '\\' && i + 1 < command.length) {
      current += c + next;
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      const stop = end === -1 ? command.length : end + 1;
      current += command.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '"') {
      const stop = closingDoubleQuote(command, i);
      current += command.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '`') {
      const end = command.indexOf('`', i + 1);
      const stop = end === -1 ? command.length : end + 1;
      current += command.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '$' && next === '(') {
      const stop = closingParen(command, i + 1);
      current += command.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(command[i - 1]))) {
      // A comment runs to the end of the line; the newline itself still separates.
      while (i < command.length && command[i] !== '\n') i += 1;
      continue;
    }
    if (c === '<' && next === '<' && command[i + 2] !== '<') {
      const heredoc = command.slice(i).match(HEREDOC);
      if (heredoc) {
        heredocs.push({ delimiter: heredoc[2] ?? heredoc[3] ?? heredoc[4], tabs: heredoc[1] === '-' });
        current += heredoc[0];
        i += heredoc[0].length;
        continue;
      }
    }
    if (c === '\n') {
      push();
      // Heredoc bodies start on the next line and are skipped up to their delimiter line.
      i = skipHeredocs(command, i + 1, heredocs);
      continue;
    }
    if ((c === '&' && next === '&') || (c === '|' && next === '|')) {
      push();
      i += 2;
      continue;
    }
    if (c === '|' && next === '&') {
      push();
      i += 2;
      continue;
    }
    if (c === ';' || c === '|') {
      push();
      i += 1;
      continue;
    }
    // A lone & runs the command in the background, but >&, &> and <& are redirections.
    if (c === '&' && command[i - 1] !== '>' && command[i - 1] !== '<' && next !== '>') {
      push();
      i += 1;
      continue;
    }
    current += c;
    i += 1;
  }
  push();
  return segments;
}

function closingDoubleQuote(s, start) {
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === '\\') i += 2;
    else if (s[i] === '"') return i + 1;
    else if (s[i] === '$' && s[i + 1] === '(') i = closingParen(s, i + 1);
    else if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      i = end === -1 ? s.length : end + 1;
    } else i += 1;
  }
  return s.length;
}

// From the "(" of "$(", the index after its matching ")", skipping quoted parts and heredoc bodies
// (Claude Code writes commit messages as "$(cat <<'EOF' … EOF)", and a message may hold quotes or parentheses).
function closingParen(s, open) {
  let depth = 0;
  let i = open;
  const heredocs = [];
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      const heredoc = s.slice(i).match(HEREDOC);
      if (heredoc) {
        heredocs.push({ delimiter: heredoc[2] ?? heredoc[3] ?? heredoc[4], tabs: heredoc[1] === '-' });
        i += heredoc[0].length;
        continue;
      }
    }
    if (c === '\n' && heredocs.length) {
      i = skipHeredocs(s, i + 1, heredocs);
      continue;
    }
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      i = end === -1 ? s.length : end + 1;
      continue;
    }
    if (c === '"') {
      i = closingDoubleQuote(s, i);
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return s.length;
}

const HEREDOC = /^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()]+))/;

// From the start of the line after a heredoc operator, skips each pending body up to its delimiter line.
function skipHeredocs(s, i, heredocs) {
  while (heredocs.length) {
    const { delimiter, tabs } = heredocs.shift();
    while (i < s.length) {
      const end = s.indexOf('\n', i);
      const line = s.slice(i, end === -1 ? s.length : end);
      i = end === -1 ? s.length : end + 1;
      // Inside $(…) the closing ")" may follow the delimiter on the same line.
      const bare = (tabs ? line.replace(/^\t+/, '') : line);
      if (bare === delimiter) break;
      if (bare.startsWith(delimiter) && /^\s*\)/.test(bare.slice(delimiter.length))) {
        i -= line.length - (line.indexOf(delimiter) + delimiter.length) + (end === -1 ? 0 : 1);
        break;
      }
    }
  }
  return i;
}

// The words of a segment, with quotes removed: enough to read a git command line.
function words(segment) {
  return [...segment.matchAll(/'([^']*)'|"((?:\\.|[^"\\])*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

// Options of git itself that take a value, before the subcommand.
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);

const ALWAYS_CHANGES = new Set([
  'add', 'commit', 'merge', 'rebase', 'reset', 'restore', 'rm', 'mv', 'cherry-pick', 'revert', 'pull', 'push',
  'clean', 'am', 'apply', 'init', 'update-ref', 'switch', 'checkout',
]);
const BRANCH_CHANGES = new Set(['-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy', '-f', '--force',
  '-u', '--set-upstream-to', '--unset-upstream', '--edit-description']);
const BRANCH_LISTS = new Set(['-l', '--list', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--show-current']);

// The git subcommand of a segment when it changes the repository, otherwise null.
export function changingGit(segment) {
  const w = words(segment);
  let i = 0;
  while (i < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i])) i += 1;
  if (w[i] === 'sudo') i += 1;
  if (w[i] !== 'git') return null;
  i += 1;
  while (i < w.length && w[i].startsWith('-')) {
    i += GIT_OPTIONS_WITH_VALUE.has(w[i]) ? 2 : 1;
  }
  const sub = w[i];
  const args = w.slice(i + 1);
  if (!sub) return null;
  if (ALWAYS_CHANGES.has(sub)) return (sub === 'switch' || sub === 'checkout') && args.length === 0 ? null : sub;
  if (sub === 'stash') return ['list', 'show'].includes(args[0]) ? null : sub;
  if (sub === 'tag') return args.length === 0 || args.some((a) => a === '-l' || a === '--list') ? null : sub;
  if (sub === 'branch') {
    if (args.some((a) => BRANCH_CHANGES.has(a))) return sub;
    if (args.some((a) => BRANCH_LISTS.has(a))) return null;
    return args.some((a) => !a.startsWith('-')) ? sub : null;
  }
  if (sub === 'worktree') return ['add', 'remove', 'move', 'prune'].includes(args[0]) ? sub : null;
  return null;
}

// A git command that stages whatever is changed in the tree rather than named paths (D125): `commit -a`, `add -A`,
// `add -u`, `add .`. It sweeps in changes that are not the task's, such as the user's own. Returns its subcommand.
export function sweepingGit(segment) {
  const w = words(segment);
  let i = 0;
  while (i < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i])) i += 1;
  if (w[i] !== 'git') return null;
  i += 1;
  while (i < w.length && w[i].startsWith('-')) i += GIT_OPTIONS_WITH_VALUE.has(w[i]) ? 2 : 1;
  const sub = w[i];
  const args = w.slice(i + 1);
  const short = (letter) => args.some((a) => /^-[a-zA-Z]+$/.test(a) && a.includes(letter));
  if (sub === 'commit') return short('a') || args.includes('--all') ? 'commit -a' : null;
  if (sub === 'add') return short('A') || short('u') || args.some((a) => ['--all', '--update', '.', ':/', './'].includes(a)) ? 'add' : null;
  return null;
}

// The verdict for one Bash command: null when allowed, otherwise the reason shown to Claude and what to log.
export function checkChain(command) {
  const segments = splitCommand(command);
  if (segments.length < 2) return null;
  const changing = segments.map(changingGit).filter(Boolean);
  if (!changing.length) return null;
  const steps = segments.map((s, n) => `${n + 1}) ${s.length > 100 ? `${s.slice(0, 97)}...` : s}`).join('\n');
  return {
    reason: `Run commands that change the repository one per Bash call, and check each result before the next (Jérôme D49). Split this into separate calls:\n${steps}`,
    subcommands: changing,
    segments: segments.length,
  };
}

// The verdict on staging (D125), checked after the chain: null when every git command names what it stages.
export function checkStaging(command) {
  const segments = splitCommand(command);
  const sweeping = segments.map(sweepingGit).filter(Boolean);
  if (!sweeping.length) return null;
  return {
    reason: 'Stage the paths this task changed by name (`git add <path> …`), then commit: `git commit -a`, `git add -A`, `-u` and `.` sweep in changes that are not the task\'s, such as the user\'s own (Jérôme D125).',
    subcommands: sweeping,
    segments: segments.length,
  };
}
