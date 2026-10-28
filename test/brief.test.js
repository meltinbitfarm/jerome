// Tests of brief parsing, the briefing prompt and the template record, without the CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripFences, parseBrief, projectFiles, provisionalProject, isProvisional } from '../src/brief.js';
import { briefingPrompt } from '../src/prompt.js';
import { readManifest } from '../src/template.js';
import { BRIEF_V2 } from './fixtures.js';


test('stripFences unwraps a fenced brief and finds it inside a chat reply', () => {
  assert.equal(stripFences(BRIEF_V2), BRIEF_V2.trim());
  assert.equal(stripFences(`\`\`\`markdown\n${BRIEF_V2}\`\`\`\n`), BRIEF_V2.trim());
  const reply = `Here is your brief:\n\n\`\`\`md\n${BRIEF_V2}\`\`\`\n\nWant changes?`;
  assert.equal(stripFences(reply), BRIEF_V2.trim());
  const notes = 'Some notes\n\n```sh\nls\n```\n\nmore notes';
  assert.equal(stripFences(notes), notes);
});

test('parseBrief reads a valid brief/v2', () => {
  const brief = parseBrief(BRIEF_V2);
  assert.equal(brief.kind, 'brief');
  assert.equal(brief.meta.name, 'Demo app');
  assert.equal(brief.meta.status, 'ready');
  assert.equal(brief.sections.Decisions, '- D1: Node only — fewer tools.');
});

test('parseBrief maps brief/v1 headings', () => {
  const v1 = BRIEF_V2.replace('brief/v2', 'brief/v1')
    .replace('## Goal', '## Obiettivo').replace('## Decisions', '## Decisioni').replace('## Context', '## Contesto')
    .replace('## Constraints', '## Vincoli').replace('## Agent limits', '## Limiti agenti').replace('## Open questions', '## Domande aperte')
    .replace('## Parked', '## Parcheggiate').replace('## Out of scope', '## Fuori scope').replace('## Success', '## Successo');
  const brief = parseBrief(v1);
  assert.equal(brief.kind, 'brief');
  assert.equal(brief.sections.Goal, 'A demo.');
});

test('parseBrief tells an unknown format from free text', () => {
  assert.deepEqual(parseBrief(BRIEF_V2.replace('brief/v2', 'brief/v4')), { kind: 'unknown-format', format: 'brief/v4' });
  // Areas belong to brief/v3: in a brief/v2 they are an unexpected section.
  assert.deepEqual(parseBrief(`${BRIEF_V2}\n## Areas\n### main\n- Goal: x\n`).reasons, ['unexpected section "Areas"']);
  assert.equal(parseBrief('Just an idea for an app').kind, 'text');
  assert.equal(parseBrief(BRIEF_V2.replace('brief/v2', 'notes')).kind, 'text');
  const missing = parseBrief(BRIEF_V2.replace('## Success\n- Tests pass.\n', ''));
  assert.deepEqual(missing.reasons, ['missing section "Success"']);
  const extra = parseBrief(`${BRIEF_V2}\n## Notes\n- extra\n`);
  assert.deepEqual(extra.reasons, ['unexpected section "Notes"']);
});

test('projectFiles sorts the sections following the Import table', () => {
  const files = projectFiles(parseBrief(BRIEF_V2));
  assert.equal(files['.jerome/PROJECT.md'], '# Demo app\n\n## Goal\nA demo.\n\n## Constraints\n- V1: no network.\n\n## Agent limits\n- L1: drafts only.\n');
  assert.equal(files['.jerome/scope.md'], '# Scope\n\n## Context\n- Built for tests.\n\n## Out of scope\n- Mobile.\n\n## Success\n- Tests pass.\n');
  assert.equal(files['.jerome/decisions.md'], '# Decisions\n\n- D1: Node only — fewer tools.\n');
  assert.equal(files['.jerome/open.md'], '# Open\n\n## Open questions\n- Q1: which name?\n\n## Parked\nnone\n\n## Backlog\nnone\n');
  // A brief without areas gets one, main, from its Goal and Success (D98).
  assert.equal(files['.jerome/areas.md'], '# Areas\n\n## main\n- Goal: A demo.\n- Milestone: first\n- Criteria: Tests pass.\n- Folder: .\n- Agents: none\n- Pace: daily\n- Priority: 1\n');
});

test('a brief/v3 brings its areas into areas.md, and their other lines into scope.md', () => {
  const v3 = `${BRIEF_V2.replace('brief/v2', 'brief/v3')}
## Areas
### development
- Goal: A web app people can sign up to.
- Milestone: MVP
- Criteria: sign-up and one list work; deployed by the owner
- Folder: .
- Pace: daily
- Priority: 1

### marketing
- Goal: 200 people on the waiting list before launch.
- Milestone: pre-launch
- Criteria: landing page draft; three posts ready
- Folder: marketing/
- Pace: weekly
- Priority: 2
- Audience: indie makers on Mastodon.
`;
  const brief = parseBrief(v3);
  assert.equal(brief.kind, 'brief');
  const files = projectFiles(brief);
  assert.match(files['.jerome/areas.md'], /^# Areas\n\n## development\n- Goal: A web app people can sign up to\.\n- Milestone: MVP\n/);
  assert.match(files['.jerome/areas.md'], /## marketing\n[\s\S]*- Folder: marketing\/\n- Agents: none\n- Pace: weekly\n- Priority: 2\n$/);
  assert.match(files['.jerome/scope.md'], /\n## Area: marketing\n- Audience: indie makers on Mastodon\.\n$/);
  assert.doesNotMatch(files['.jerome/scope.md'], /## Area: development/);
  // A malformed area makes the brief one to convert, not one imported half right.
  const bad = parseBrief(v3.replace('- Pace: weekly', '- Pace: sometimes'));
  assert.equal(bad.kind, 'text');
  assert.match(bad.reasons.join(), /Areas: area "marketing": Pace is hourly, daily, weekly or paused/);
});

test('the provisional PROJECT.md is recognized', () => {
  const content = provisionalProject(['no front matter']);
  assert.ok(isProvisional(content));
  assert.match(content, /Your next reply must start the conversion, whatever the user asks/);
  assert.match(content, /Do not answer it, start it or run any tool for it/);
  assert.ok(!isProvisional('# Demo app\n'));
});

test('the briefing prompt holds the rules and the format, not the Claude Code parts', () => {
  const prompt = briefingPrompt();
  assert.match(prompt, /single markdown block/);
  assert.match(prompt, /silence, or moving on to another topic, is not confirmation/i);
  assert.match(prompt, /format: brief\/v3/);
  assert.match(prompt, /## Areas \(optional\)/);
  assert.match(prompt, /## Decisions/);
  assert.doesNotMatch(prompt, /## Import|Reading brief\/v1|\.jerome|MementoVault|Area briefing/);
});

test('a MANIFEST that lists project state is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jerome-manifest-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'MANIFEST'), 'CLAUDE.md\nPROJECT.md\n');
  assert.throws(() => readManifest(dir), /belongs to the project/);
  writeFileSync(join(dir, 'MANIFEST'), '.claude/\n');
  assert.throws(() => readManifest(dir), /belongs to the project/);
});

test('parseBrief imports a brief with a chat preamble, and lists the text it left out', () => {
  const chatty = `Sure! Here is the brief we agreed on.\n\n${BRIEF_V2.replace('---\n\n## Goal', '---\n\n> Saved from my phone.\n\n## Goal')}`;
  const brief = parseBrief(chatty);
  assert.equal(brief.kind, 'brief');
  assert.deepEqual(brief.ignored, [
    'text before the front matter: "Sure! Here is the brief we agreed on."',
    'text before the first section: "> Saved from my phone."',
  ]);
  assert.equal(brief.sections.Goal, 'A demo.');
  assert.deepEqual(parseBrief(BRIEF_V2).ignored, []);
  // A horizontal rule in the preamble is not taken for the front matter.
  assert.equal(parseBrief(`Notes\n---\nmore\n---\n\n${BRIEF_V2}`).kind, 'brief');
});

test('no section of the brief is lost in the import (D37)', () => {
  const full = BRIEF_V2.replace('## Open questions', '## Tools\n- Node 24.\n\n## Pace and usage\n- Weekly.\n\n## Open questions');
  const brief = parseBrief(full);
  const files = Object.values(projectFiles(brief)).join('\n');
  for (const [name, body] of Object.entries(brief.sections)) {
    assert.ok(files.includes(`## ${name}\n${body}`) || (name === 'Decisions' && files.includes(body)), `${name} is missing`);
  }
});

test('a MANIFEST that lists the project agents or settings.json is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jerome-manifest-'));
  for (const entry of ['.claude/agents/', '.claude/agents/developer.md', '.claude/settings.json', 'docs/_pending.md']) {
    writeFileSync(join(dir, 'MANIFEST'), `CLAUDE.md\n${entry}\n`);
    assert.throws(() => readManifest(dir), /belongs to the project/, entry);
  }
});
