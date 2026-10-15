// The hooks and the status line that `jerome doctor` writes into the project's `.claude/settings.json` (D59, D60),
// next to the project's own. Jérôme's hooks are recognised by their command.
import { readSettings, writeSettings, SHARED_SETTINGS, LOCAL_SETTINGS } from './profile.js';
import { STATUSLINE_COMMAND } from './statusline.js';

// Stop and SubagentStop run in the background, so they never slow the session down; SessionEnd reads whatever they
// missed, with a 10-second budget instead of the default 1.5. SessionStart and the chain check are synchronous.
export const HOOKS = [
  { event: 'SessionStart', hook: { type: 'command', command: 'jerome hook session-start' } },
  { event: 'SubagentStop', hook: { type: 'command', command: 'jerome hook subagent-stop', async: true } },
  { event: 'Stop', hook: { type: 'command', command: 'jerome hook stop', async: true } },
  { event: 'SessionEnd', hook: { type: 'command', command: 'jerome hook session-end', timeout: 10 } },
  { event: 'PreToolUse', matcher: 'Bash', hook: { type: 'command', command: 'jerome hook pre-tool-use' } },
];

export const STATUSLINE = { type: 'command', command: STATUSLINE_COMMAND };

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// What is missing or different, as readable strings, plus the settings with it fixed.
export function planHooks(dir) {
  const settings = readSettings(dir, SHARED_SETTINGS);
  const next = structuredClone(settings);
  const changes = [];
  next.hooks ??= {};
  for (const { event, matcher, hook } of HOOKS) {
    const groups = (next.hooks[event] ??= []);
    let found = false;
    for (const group of groups) {
      for (let i = 0; i < (group.hooks ?? []).length; i += 1) {
        if (group.hooks[i].command !== hook.command) continue;
        found = true;
        if (!same(group.hooks[i], hook) || (matcher && group.matcher !== matcher)) {
          group.hooks[i] = hook;
          if (matcher) group.matcher = matcher;
          changes.push(`hook ${event}: updated`);
        }
      }
    }
    if (!found) {
      groups.push(matcher ? { matcher, hooks: [hook] } : { hooks: [hook] });
      changes.push(`hook ${event}: added`);
    }
  }
  // The project's status line: set only when neither settings file has one, never replacing another.
  const local = readSettings(dir, LOCAL_SETTINGS).statusLine;
  let statusline = 'jerome';
  if (local && local.command !== STATUSLINE_COMMAND) statusline = 'other';
  else if (next.statusLine && next.statusLine.command !== STATUSLINE_COMMAND) statusline = 'other';
  else if (!next.statusLine) {
    next.statusLine = STATUSLINE;
    changes.push('statusLine: added');
  }
  return { settings: next, changes, statusline };
}

export function applyHooks(dir) {
  const plan = planHooks(dir);
  if (plan.changes.length) writeSettings(dir, plan.settings, SHARED_SETTINGS);
  return plan;
}
