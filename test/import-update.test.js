// Tests of `jerome new --from-file`, `jerome prompt` and `jerome update`, with the fake `claude` of the sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sandbox, readyProject } from './sandbox.js';
import { BRIEF_V2 } from './fixtures.js';

const TEMPLATE = join(import.meta.dirname, '..', 'template');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const marker = (dir) => JSON.parse(readFileSync(join(dir, '.jerome', 'project.json'), 'utf8'));

test('new --from-file imports a valid brief into the project files', () => {
  const { root, run } = sandbox();
  writeFileSync(join(root, 'brief.txt'), BRIEF_V2);
  const r = run('new', 'demo', '--from-file', 'brief.txt');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ Brief imported \(brief\/v2\) into \.jerome\/: PROJECT\.md, scope\.md, areas\.md, decisions\.md, open\.md and brief\.md/);
  const dir = join(root, 'demo');
  assert.match(readFileSync(join(dir, '.jerome', 'PROJECT.md'), 'utf8'), /^# Demo app\n/);
  assert.doesNotMatch(readFileSync(join(dir, '.jerome', 'PROJECT.md'), 'utf8'), /## (Context|Success|Out of scope)/);
  assert.match(readFileSync(join(dir, '.jerome', 'scope.md'), 'utf8'), /^# Scope\n\n## Context\n- Built for tests\./);
  assert.match(readFileSync(join(dir, '.jerome', 'decisions.md'), 'utf8'), /D1: Node only/);
  assert.match(readFileSync(join(dir, '.jerome', 'open.md'), 'utf8'), /Q1: which name\?/);
  assert.equal(readFileSync(join(dir, '.jerome', 'brief.md'), 'utf8'), BRIEF_V2);
  // The marker records the template it was created from (D30).
  const m = marker(dir);
  assert.equal(m.schema, 'jerome.project/v1');
  assert.equal(m.files['.claude/rules/jerome.md'], sha(readFileSync(join(TEMPLATE, '.claude', 'rules', 'jerome.md'))));
  assert.ok(!('PROJECT.md' in m.files));
});

test('new --from-file - reads standard input and removes code fences', () => {
  const { root, runInput } = sandbox();
  const r = runInput(`Here it is:\n\n\`\`\`markdown\n${BRIEF_V2.replace('ready ', 'draft ')}\`\`\`\n`, 'new', 'demo', '--from-file', '-');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /The brief is a draft/);
  assert.equal(readFileSync(join(root, 'demo', '.jerome', 'brief.md'), 'utf8'), BRIEF_V2.replace('ready ', 'draft '));
});

test('new --from-file with an unknown format, an empty input or a missing file creates nothing', () => {
  const { root, run, runInput } = sandbox();
  let r = runInput(BRIEF_V2.replace('brief/v2', 'brief/v4'), 'new', 'demo', '--from-file', '-');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /brief\/v4.*update Jérôme/);
  r = runInput('  \n', 'new', 'demo', '--from-file', '-');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /empty/);
  r = run('new', 'demo', '--from-file', 'nope.md');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Cannot read the brief/);
  assert.ok(!existsSync(join(root, 'demo')));
});

test('new --from-file with free text writes a provisional PROJECT.md that doctor warns about', () => {
  const { root, runInput, run } = sandbox();
  const r = runInput('An app to track my plants, maybe with reminders.\n', 'new', 'demo', '--from-file', '-');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /brief\.md is not a valid brief\/v3 \(no front matter\)/);
  const dir = join(root, 'demo');
  assert.equal(readFileSync(join(dir, '.jerome', 'brief.md'), 'utf8'), 'An app to track my plants, maybe with reminders.\n');
  assert.match(readFileSync(join(dir, '.jerome', 'PROJECT.md'), 'utf8'), /^<!-- jerome:provisional -->/);
  assert.ok(!existsSync(join(dir, '.jerome', 'decisions.md')));
  const d = run('doctor', 'demo', '--check', '--json');
  const report = JSON.parse(d.stdout);
  assert.equal(report.ok, true);
  assert.equal(d.status, 0);
  // The fake claude reports a 1.1k PROJECT.md, so a budget warning comes too.
  assert.ok(report.warnings.some((w) => w.id === 'provisional-project'));
});

test('new --from-file imports a brief with a preamble at zero tokens, with a warning', () => {
  const { root, runInput } = sandbox();
  const r = runInput(`Here is your brief:\n\n${BRIEF_V2}`, 'new', 'demo', '--from-file', '-');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ Brief imported/);
  assert.match(r.stdout, /! Ignored text before the front matter: "Here is your brief:"/);
  assert.match(readFileSync(join(root, 'demo', '.jerome', 'PROJECT.md'), 'utf8'), /^# Demo app\n/);
});

test("doctor and update leave Jérôme's own repository alone", () => {
  const { root, run } = sandbox();
  run('new', 'repo');
  const dir = join(root, 'repo');
  mkdirSync(join(dir, 'template'));
  writeFileSync(join(dir, 'template', 'MANIFEST'), 'CLAUDE.md\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@meltinbitfarm/jerome' }));
  writeFileSync(join(dir, '.claude', 'rules', 'jerome.md'), 'old lead agent\n');
  const m = marker(dir);
  m.files['.claude/rules/jerome.md'] = sha('old lead agent\n');
  writeFileSync(join(dir, '.jerome', 'project.json'), JSON.stringify(m));
  const report = JSON.parse(run('doctor', 'repo', '--check', '--json').stdout);
  assert.ok(!report.warnings.some((w) => w.id === 'template'));
  const r = run('update', 'repo', '--yes');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Jérôme's own repository/);
  assert.equal(readFileSync(join(dir, '.claude', 'rules', 'jerome.md'), 'utf8'), 'old lead agent\n');
});

test('doctor warns about a PROJECT.md with sections that belong in scope.md', () => {
  const { root, run } = sandbox();
  run('new', 'demo');
  writeFileSync(join(root, 'demo', '.jerome', 'PROJECT.md'), '# Demo\n\n## Goal\nA demo.\n\n## Context\n- x\n\n## Success\n- y\n');
  const w = JSON.parse(run('doctor', 'demo', '--check', '--json').stdout).warnings.find((x) => x.id === 'project-layout');
  assert.deepEqual(w.sections, ['Context', 'Success']);
  assert.match(w.message, /move Context, Success from PROJECT\.md to scope\.md/);
});

test('prompt prints the briefing instructions', () => {
  const { run } = sandbox();
  const r = run('prompt');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^You are going to run a project briefing/);
  assert.match(r.stdout, /format: brief\/v3/);
  assert.equal(run('prompt', 'extra').status, 2);
});

test('update on a current project changes nothing', () => {
  const { root, run } = sandbox();
  run('new', 'demo');
  const before = readFileSync(join(root, 'demo', '.jerome', 'project.json'), 'utf8');
  const r = run('update', 'demo');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ Template files up to date/);
  assert.equal(readFileSync(join(root, 'demo', '.jerome', 'project.json'), 'utf8'), before);
});

test('update replaces unchanged template files, and leaves files changed in the project unless asked', () => {
  const { root, run } = sandbox();
  run('new', 'demo');
  const dir = join(root, 'demo');
  const skill = '.claude/skills/project-brief/SKILL.md';
  // Simulate an older template: both files were copied from an "old" version, and SKILL.md was then changed here.
  writeFileSync(join(dir, '.claude', 'rules', 'jerome.md'), 'old lead agent\n');
  writeFileSync(join(dir, skill), 'my own skill\n');
  writeFileSync(join(dir, '.jerome', 'PROJECT.md'), '# Mine\n');
  const m = marker(dir);
  m.files['.claude/rules/jerome.md'] = sha('old lead agent\n');
  m.files[skill] = sha('old skill\n');
  writeFileSync(join(dir, '.jerome', 'project.json'), JSON.stringify(m));

  const warned = JSON.parse(run('doctor', 'demo', '--check', '--json').stdout).warnings.find((w) => w.id === 'template');
  assert.deepEqual(warned.files, [{ path: '.claude/rules/jerome.md', status: 'update' }, { path: skill, status: 'modified' }]);

  let r = run('update', 'demo', '--check');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /update +\.claude\/rules\/jerome\.md/);
  assert.match(r.stdout, /changed here +\.claude\/skills\/project-brief\/SKILL\.md/);
  assert.match(r.stdout, /--- project\/\.claude\/rules\/jerome\.md/);
  assert.equal(readFileSync(join(dir, '.claude', 'rules', 'jerome.md'), 'utf8'), 'old lead agent\n');

  // Without a terminal and without --yes nothing is written.
  r = run('update', 'demo');
  assert.equal(r.status, 1);
  assert.equal(readFileSync(join(dir, '.claude', 'rules', 'jerome.md'), 'utf8'), 'old lead agent\n');

  r = run('update', 'demo', '--yes');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(dir, '.claude', 'rules', 'jerome.md'), 'utf8'), readFileSync(join(TEMPLATE, '.claude', 'rules', 'jerome.md'), 'utf8'));
  assert.equal(readFileSync(join(dir, skill), 'utf8'), 'my own skill\n');
  assert.match(r.stdout, /SKILL\.md was changed in this project: left as it is/);
  assert.equal(readFileSync(join(dir, '.jerome', 'PROJECT.md'), 'utf8'), '# Mine\n');
  const after = marker(dir);
  assert.equal(after.files['.claude/rules/jerome.md'], sha(readFileSync(join(TEMPLATE, '.claude', 'rules', 'jerome.md'))));
  assert.equal(after.files[skill], sha('old skill\n'));
});

test('update gives an old project its record, treats differences as changes and reports dropped files', () => {
  const { root, run } = sandbox();
  run('new', 'demo');
  const dir = join(root, 'demo');
  writeFileSync(join(dir, '.jerome', 'project.json'), '');
  writeFileSync(join(dir, '.claude', 'rules', 'jerome.md'), 'customized\n');
  const stale = join(dir, '.claude/skills/project-brief/references/storage-old.md');
  writeFileSync(stale, 'old adapter\n');

  let r = run('update', 'demo', '--yes');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /storage-old\.md is no longer in the template, but it was changed in this project or has no record: left in place/);
  assert.match(r.stdout, /jerome\.md was changed in this project: left as it is/);
  assert.ok(existsSync(stale));
  const m = marker(dir);
  assert.equal(m.schema, 'jerome.project/v1');
  assert.ok(!('.claude/rules/jerome.md' in m.files));
  assert.ok('.claude/skills/project-brief/SKILL.md' in m.files);

  mkdirSync(join(root, 'plain'));
  r = run('update', 'plain');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a Jérôme project/);
});

test('update removes the root MANIFEST of older projects when unchanged, and keeps it when changed', () => {
  const { root, run } = sandbox();
  run('new', 'demo');
  run('new', 'other');
  for (const [name, content] of [['demo', 'CLAUDE.md\nMANIFEST\n'], ['other', 'CLAUDE.md\nMANIFEST\n']]) {
    const dir = join(root, name);
    writeFileSync(join(dir, 'MANIFEST'), content);
    const m = marker(dir);
    m.files.MANIFEST = sha(content);
    writeFileSync(join(dir, '.jerome', 'project.json'), JSON.stringify(m));
  }
  writeFileSync(join(root, 'other', 'MANIFEST'), 'my notes\n');

  const warned = JSON.parse(run('doctor', 'demo', '--check', '--json').stdout).warnings.find((w) => w.id === 'template');
  assert.deepEqual(warned.files, [{ path: 'MANIFEST', status: 'remove' }]);
  let r = run('update', 'demo', '--check');
  assert.match(r.stdout, /remove +MANIFEST/);
  assert.ok(existsSync(join(root, 'demo', 'MANIFEST')));
  r = run('update', 'demo', '--yes');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /0 files updated, 1 removed/);
  assert.ok(!existsSync(join(root, 'demo', 'MANIFEST')));
  assert.ok(!('MANIFEST' in marker(join(root, 'demo')).files));
  assert.match(run('update', 'demo').stdout, /up to date/);

  r = run('update', 'other', '--yes');
  assert.match(r.stdout, /MANIFEST is no longer in the template, but it was changed in this project/);
  assert.equal(readFileSync(join(root, 'other', 'MANIFEST'), 'utf8'), 'my notes\n');
});

test('options of other commands are refused', () => {
  const { run } = sandbox();
  assert.equal(run('new', 'demo', '--yes').status, 2);
  assert.equal(run('update', '--json').status, 2);
  assert.equal(run('doctor', '--from-file', 'x').status, 2);
});

test('update commits the files it writes, so the next heartbeat does not stop on them (D158)', () => {
  const p = readyProject();
  p.git('config', 'user.email', 't@example.com');
  p.git('config', 'user.name', 't');
  writeFileSync(join(p.dir, '.claude', 'rules', 'jerome.md'), 'old lead agent\n');
  const m = marker(p.dir);
  m.files['.claude/rules/jerome.md'] = sha('old lead agent\n');
  writeFileSync(join(p.dir, '.jerome', 'project.json'), JSON.stringify(m));
  p.git('add', '-A');
  p.git('commit', '-q', '-m', 'an older template');
  const r = p.run('update', 'demo', '--yes');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ Committed as "Jérôme: template files updated to /);
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: p.dir, encoding: 'utf8' }), '');
  assert.match(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: p.dir, encoding: 'utf8' }), /^Jérôme: template files updated to /);
});

test('update writes nothing while a heartbeat runs in the project, so the run does not end on files of its own (D190)', () => {
  const p = readyProject();
  p.git('config', 'user.email', 't@example.com');
  p.git('config', 'user.name', 't');
  writeFileSync(join(p.dir, '.claude', 'rules', 'jerome.md'), 'old lead agent\n');
  const m = marker(p.dir);
  m.files['.claude/rules/jerome.md'] = sha('old lead agent\n');
  writeFileSync(join(p.dir, '.jerome', 'project.json'), JSON.stringify(m));
  p.git('add', '-A');
  p.git('commit', '-q', '-m', 'an older template');
  const label = execFileSync(process.execPath, ['-e', `import('${new URL('../src/schedule.js', import.meta.url)}').then(m => console.log(m.jobLabel(${JSON.stringify(p.dir)})))`], { encoding: 'utf8' }).trim();
  const lock = join(p.root, '.cache', 'jerome', 'locks', `${label}.lock`);
  mkdirSync(join(lock, '..'), { recursive: true });
  writeFileSync(lock, String(process.pid));
  const r = p.run('update', 'demo', '--yes');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /A heartbeat is running in this project \(pid \d+\): nothing was changed/);
  assert.equal(readFileSync(join(p.dir, '.claude', 'rules', 'jerome.md'), 'utf8'), 'old lead agent\n');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: p.dir, encoding: 'utf8' }), '');
  // Once it ends, the update goes through and is committed.
  writeFileSync(lock, '999999');
  const again = p.run('update', 'demo', '--yes');
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /✓ Committed as "Jérôme: template files updated to /);
});
