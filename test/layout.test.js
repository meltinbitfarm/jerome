// Tests of the .jerome/ layout (D87-D89): what a new project looks like, `jerome init` on an existing project,
// and the move of a project from the layout before D87.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sandbox } from './sandbox.js';
import { applyMigrations } from '../src/db.js';
import { layoutPlan, migrateLayout, countRows } from '../src/migrate.js';
import { readdirSync } from 'node:fs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const git = (dir, ...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });

test('a new project keeps Jérôme in .jerome/ and .claude/, and nothing at its root but .gitignore lines', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const dir = join(root, 'demo');
  assert.ok(existsSync(join(dir, '.jerome', 'project.json')));
  assert.ok(existsSync(join(dir, '.jerome', 'jerome.db')));
  assert.ok(existsSync(join(dir, '.claude', 'rules', 'jerome.md')));
  assert.match(readFileSync(join(dir, '.claude', 'rules', 'jerome.md'), 'utf8'), /^@\.\.\/\.\.\/\.jerome\/PROJECT\.md$/m);
  for (const old of ['CLAUDE.md', 'PROJECT.md', 'decisions.md', '.jerome.db', 'notes', 'docs']) assert.ok(!existsSync(join(dir, old)), old);
  const ignore = readFileSync(join(dir, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.jerome\/jerome\.db\*$/m);
  assert.match(ignore, /^\.claude\/settings\.local\.json$/m);
});

test('jerome init adopts an existing project without overwriting anything, and shows its own instructions', () => {
  const { root, run } = sandbox();
  const dir = join(root, 'shop');
  mkdirSync(join(dir, '.claude', 'skills', 'docs'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  const own = {
    'CLAUDE.md': '# Shop\n\nAlways commit straight to main.\n',
    '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(php artisan test)'] }, model: 'sonnet' }),
    '.claude/skills/docs/SKILL.md': '---\nname: docs\ndescription: The shop docs.\n---\nOur own docs skill.\n',
    'docs/index.md': '# Shop docs\n',
    '.gitignore': 'vendor/\n',
  };
  for (const [file, text] of Object.entries(own)) writeFileSync(join(dir, file), text);
  git(dir, 'init', '-q', '-b', 'main');

  const r = run('init', 'shop');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ Jérôme added to /);
  assert.match(r.stdout, /! \.claude\/skills\/docs\/SKILL\.md already exists and differs from Jérôme's: left as it is/);
  for (const file of ['CLAUDE.md', '.claude/skills/docs/SKILL.md', 'docs/index.md']) assert.equal(readFileSync(join(dir, file), 'utf8'), own[file], file);
  const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.model, 'sonnet');
  assert.equal(settings.permissions.allow[0], 'Bash(php artisan test)');
  assert.ok(settings.permissions.deny.includes('Bash(git push *)'));
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^vendor\/\n[\s\S]*\.jerome\/jerome\.db\*/);
  assert.ok(existsSync(join(dir, '.claude', 'rules', 'jerome.md')));
  // The project's own CLAUDE.md is loaded in every session too: its weight is shown next to Jérôme's.
  assert.match(r.stdout, /instructions in every session and heartbeat: Jérôme's \.claude\/rules\/jerome\.md 496; the project's own CLAUDE\.md 36 tokens/);
  assert.match(r.stdout, /ask for the briefing/);

  assert.equal(run('init', 'shop').status, 1, 'a second init changes nothing');
  mkdirSync(join(root, 'nogit'));
  const plain = run('init', 'nogit');
  assert.match(plain.stdout, /not a git repository/);
});

// A project in the layout before D87, as Jérôme 0.1.0 left it.
function legacyProject(root, { leadChanged = false } = {}) {
  const dir = join(root, 'old');
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  mkdirSync(join(dir, 'notes'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  const lead = '# Lead agent\n\n@PROJECT.md\n';
  writeFileSync(join(dir, 'CLAUDE.md'), leadChanged ? `${lead}- Use pnpm.\n` : lead);
  writeFileSync(join(dir, '.jerome'), JSON.stringify({ schema: 'jerome.project/v1', jerome: '0.1.0', files: { 'CLAUDE.md': sha(lead) }, budgets: { 'CLAUDE.md': 700 } }));
  writeFileSync(join(dir, 'PROJECT.md'), '# Old\n');
  writeFileSync(join(dir, 'decisions.md'), '# Decisions\n\n- D1: kept — history\n');
  writeFileSync(join(dir, 'notes', 'review.md'), 'notes\n');
  writeFileSync(join(dir, 'docs', '_pending.md'), '- 2026-10-15 · developer · a.js · queued\n');
  writeFileSync(join(dir, 'docs', 'index.md'), '# Docs\n');
  writeFileSync(join(dir, '.claude', 'agents', 'developer.md'), '---\nname: developer\nmodel: opus\nomitClaudeMd: true\n---\nAppend to `docs/_pending.md`; details in `notes/x.md`.\n');
  writeFileSync(join(dir, '.gitignore'), '.claude/settings.local.json\n.jerome.db*\n');
  const db = new DatabaseSync(join(dir, '.jerome.db'));
  applyMigrations(db);
  db.prepare("INSERT INTO runs (session_id, kind, started_at, status) VALUES ('s0', 'interactive', '2026-10-01T00:00:00Z', 'done')").run();
  db.close();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'old layout');
  return dir;
}

test('jerome update moves an old project to .jerome/, keeping git history, data and the project\'s own files', () => {
  const { root, run } = sandbox();
  const dir = legacyProject(root);
  const doctor = run('doctor', 'old', '--check');
  assert.equal(doctor.status, 1);
  assert.match(doctor.stderr, /uses the layout from before .*run `jerome update`/);

  const check = run('update', 'old', '--check');
  assert.equal(check.status, 1);
  assert.match(check.stdout, /move +\.jerome → \.jerome\/project\.json/);
  assert.match(check.stdout, /move +decisions\.md → \.jerome\/decisions\.md/);
  assert.match(check.stdout, /remove +CLAUDE\.md \(the template's/);
  assert.ok(existsSync(join(dir, 'decisions.md')), '--check moves nothing');

  const r = run('update', 'old', '--yes');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ Moved to \.jerome\/ \(tracked files with git mv/);
  for (const file of ['project.json', 'PROJECT.md', 'decisions.md', 'notes/review.md', 'docs-queue.md', 'jerome.db']) assert.ok(existsSync(join(dir, '.jerome', file)), file);
  for (const old of ['CLAUDE.md', 'PROJECT.md', 'decisions.md', 'notes', '.jerome.db', 'docs/_pending.md']) assert.ok(!existsSync(join(dir, old)), old);
  assert.ok(existsSync(join(dir, 'docs', 'index.md')), 'the project\'s docs stay');
  assert.ok(existsSync(join(dir, '.claude', 'rules', 'jerome.md')), 'the template update brings jerome.md');
  // History follows the moved files, once the moves are committed.
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'move to .jerome/');
  assert.match(git(dir, 'log', '--follow', '--format=%s', '--', '.jerome/decisions.md'), /old layout/);
  const db = new DatabaseSync(join(dir, '.jerome', 'jerome.db'), { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) n FROM runs').get().n, 1);
  db.close();
  const marker = JSON.parse(readFileSync(join(dir, '.jerome', 'project.json'), 'utf8'));
  assert.deepEqual(marker.budgets, { 'jerome.md': 700 });
  assert.ok(!('CLAUDE.md' in marker.files));
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.jerome\/jerome\.db\*$/m);
  assert.doesNotMatch(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.jerome\.db\*$/m);
  assert.equal(readFileSync(join(dir, '.claude', 'agents', 'developer.md'), 'utf8').split('---\n')[2], 'Append to `.jerome/docs-queue.md`; details in `.jerome/notes/x.md`.\n');
});

test('a changed root CLAUDE.md stays as the project\'s own, and a running session postpones the move', () => {
  const { root, run } = sandbox();
  const dir = legacyProject(root, { leadChanged: true });
  const db = new DatabaseSync(join(dir, '.jerome.db'));
  db.prepare("INSERT INTO runs (session_id, kind, started_at, status) VALUES ('live', 'interactive', ?, 'running')").run(new Date().toISOString());
  db.close();
  const busy = run('update', 'old', '--yes');
  assert.equal(busy.status, 1);
  assert.match(busy.stderr, /Not now: an interactive session is open/);
  assert.ok(existsSync(join(dir, 'decisions.md')));

  const d2 = new DatabaseSync(join(dir, '.jerome.db'));
  d2.prepare("UPDATE runs SET status = 'done' WHERE session_id = 'live'").run();
  d2.close();
  const r = run('update', 'old', '--yes');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /CLAUDE\.md was changed in this project and stays as its own/);
  assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /Use pnpm/);
});

test('a heartbeat on an old project does not start and asks for jerome update', () => {
  const { root, run } = sandbox();
  legacyProject(root);
  const r = run('heartbeat', 'old');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not started: this project uses the layout from before \.jerome\/; run `jerome update`/);
});

test('an old project with an empty marker gets a readable record', () => {
  const { root, run } = sandbox();
  const dir = legacyProject(root);
  writeFileSync(join(dir, '.jerome'), '');
  git(dir, 'commit', '-q', '-am', 'empty marker');
  const r = run('update', 'old', '--yes');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const marker = JSON.parse(readFileSync(join(dir, '.jerome', 'project.json'), 'utf8'));
  assert.equal(marker.schema, 'jerome.project/v1');
  assert.equal(JSON.parse(run('doctor', 'old', '--check', '--json').stdout).checks.find((c) => c.id === 'project').ok, true);
});

test('the database survives what lost claude-watch\'s: a backup outside the repository, with every row', () => {
  const { root, run } = sandbox();
  const dir = legacyProject(root);
  const rows = countRows(join(dir, '.jerome.db'));
  // The move on a side branch, then back to a branch from before it, where .jerome is a file.
  git(dir, 'switch', '-q', '-c', 'layout');
  const r = run('update', 'old', '--yes');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /database: 1 runs, 0 usage, 0 usage_daily, 0 transcript_reads, 0 events, 0 requests, copied and checked; a backup is in /);
  assert.match(r.stdout, /Checking out a branch or commit from before the move deletes \.jerome\/jerome\.db/);
  assert.deepEqual(countRows(join(dir, '.jerome', 'jerome.db')), rows);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'move');
  git(dir, 'switch', '-q', 'main');
  // Git removed the ignored database to put .jerome back as a file: what happened on claude-watch.
  assert.ok(!existsSync(join(dir, '.jerome', 'jerome.db')));
  const backups = join(root, '.cache', 'jerome', 'backups');
  const [backup] = readdirSync(backups);
  assert.match(backup, /^old-[0-9a-f]{8}-.*\.db$/);
  assert.deepEqual(countRows(join(backups, backup)), rows);
});

test('a copy of the database that does not match leaves everything where it was', () => {
  const { root } = sandbox();
  const dir = legacyProject(root);
  const rows = countRows(join(dir, '.jerome.db'));
  const truncated = (from, to) => {
    const db = new DatabaseSync(to);
    applyMigrations(db);
    db.close();
  };
  // In this process the backup would go to the real cache: it goes to the sandbox's.
  const cache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = join(root, '.cache');
  try {
    assert.throws(() => migrateLayout(dir, layoutPlan(dir), { copy: truncated }), /the copied database does not match the original .* nothing was moved/);
  } finally {
    if (cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = cache;
  }
  assert.equal(readdirSync(join(root, '.cache', 'jerome', 'backups')).length, 1, 'the backup is kept');
  assert.deepEqual(countRows(join(dir, '.jerome.db')), rows);
  assert.ok(!existsSync(join(dir, '.jerome.db.moving')));
  assert.ok(existsSync(join(dir, 'decisions.md')), 'no file moved');
  assert.equal(readFileSync(join(dir, '.jerome'), 'utf8').startsWith('{'), true, '.jerome is still the file');
});
