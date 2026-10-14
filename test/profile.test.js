import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyProfile, desiredProfile, parseContext, findLeaks, overrideFor } from '../src/profile.js';

const CONTEXT = `## Context Usage

**Model:** claude-opus-5-5
**Tokens:** 12.2k / 1m (1%)

### Estimated usage by category

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 2.4k | 0.2% |
| MCP tools | 615 | 0.1% |
| Skills | 9.7k | 1.0% |

### Skills

| Skill | Source | Tokens |
|-------|--------|--------|
| project-brief | Project | ~200 |
| anthropic-skills:project-brief | claude.ai sync | ~210 |
| docx | claude.ai sync | ~320 |
| shopify-plugin:shopify-dev | Plugin (shopify-plugin) | ~40 |
| plugin-authoring | Built-in | ~90 |
`;

test('desiredProfile turns off plugins and synced skills by qualified name', () => {
  const p = desiredProfile({ plugins: ['a@m', 'b@synced'], syncedSkills: ['project-brief', 'docx'] });
  assert.deepEqual(p.enabledPlugins, { 'a@m': false, 'b@synced': false });
  assert.deepEqual(p.skillOverrides, { 'anthropic-skills:project-brief': 'off', 'anthropic-skills:docx': 'off' });
  assert.equal(p.disableClaudeAiConnectors, true);
  assert.equal(p.disableBundledSkills, true);
});

test('applyProfile touches only Jérôme keys and keeps the others', () => {
  const current = {
    hooks: { Stop: [] },
    permissions: { allow: ['Bash(ls)'] },
    enabledPlugins: { 'mio@m': true, 'a@m': true },
    skillOverrides: { mia: 'off' },
  };
  const { settings, changes } = applyProfile(current, desiredProfile({ plugins: ['a@m'], syncedSkills: ['docx'] }));
  assert.deepEqual(settings.hooks, current.hooks);
  assert.deepEqual(settings.permissions, current.permissions);
  assert.deepEqual(settings.enabledPlugins, { 'mio@m': true, 'a@m': false });
  assert.deepEqual(settings.skillOverrides, { mia: 'off', 'anthropic-skills:docx': 'off' });
  assert.equal(changes.length, 4);
  assert.equal(current.enabledPlugins['a@m'], true, 'the input must not be modified');
});

test('applyProfile is idempotent', () => {
  const profile = desiredProfile({ plugins: ['a@m'], syncedSkills: ['docx'] });
  const once = applyProfile({}, profile).settings;
  assert.deepEqual(applyProfile(once, profile).changes, []);
});

test('parseContext reads total, categories and skills', () => {
  const ctx = parseContext(CONTEXT);
  assert.equal(ctx.total, '12.2k');
  assert.deepEqual(ctx.categories.map((c) => c.name), ['System prompt', 'MCP tools', 'Skills']);
  assert.equal(ctx.skills.length, 5);
  assert.deepEqual(ctx.skills[0], { name: 'project-brief', source: 'Project', tokens: '~200' });
});

test('parseContext rejects an unknown format', () => {
  assert.throws(() => parseContext('something else'), /unrecognized/);
});

test('findLeaks: non-project skills and MCP tools without .mcp.json', () => {
  const ctx = parseContext(CONTEXT);
  const leaks = findLeaks(ctx, { hasProjectMcp: false });
  assert.equal(leaks.skills.length, 4);
  assert.equal(leaks.mcp.length, 1);
  assert.equal(findLeaks(ctx, { hasProjectMcp: true }).mcp.length, 0);
});

test('overrideFor qualifies synced skills and skips plugins', () => {
  assert.equal(overrideFor({ name: 'docx', source: 'claude.ai sync' }), 'anthropic-skills:docx');
  assert.equal(overrideFor({ name: 'anthropic-skills:docx', source: 'claude.ai sync' }), 'anthropic-skills:docx');
  assert.equal(overrideFor({ name: 'plugin-authoring', source: 'Built-in' }), 'plugin-authoring');
  assert.equal(overrideFor({ name: 'x:y', source: 'Plugin (x)' }), null);
});
