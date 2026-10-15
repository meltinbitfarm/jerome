import { parseArgs } from 'node:util';
import { newProject } from './new.js';
import { doctor } from './doctor.js';
import { update } from './update.js';
import { prompt } from './prompt.js';
import { docs } from './docs.js';

const USAGE = `Usage:
  jerome new <name>       create a project from the template in the folder <name>
    --from-file <path>    import a brief from a file, or from standard input with -
  jerome prompt           print the briefing instructions to paste into any chat
  jerome doctor [dir]     check the setup and restore the lean profile (default: current folder)
    --check               only check and report: write nothing (what external tools should use)
    --json                print a machine-readable report (schema jerome.doctor/v1)
  jerome update [dir]     bring the project's template files up to the installed version
    --check               only show what would change: write nothing
    --yes                 apply without asking; files changed in the project are left as they are
  jerome docs [dir]       bring the entries of docs/_pending.md into the documentation, with the documentarist`;

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  json: { type: 'boolean' },
  check: { type: 'boolean' },
  yes: { type: 'boolean' },
  'from-file': { type: 'string' },
};

// The options each command accepts; any other option is a usage error.
const ALLOWED = { new: ['from-file'], prompt: [], doctor: ['json', 'check'], update: ['check', 'yes'], docs: [] };

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  const [command, ...rest] = parsed.positionals;
  if (parsed.values.help || !command) {
    console.log(USAGE);
    return command || parsed.values.help ? 0 : 2;
  }
  if (!(command in ALLOWED)) return usageError(`Unknown command: ${command}`);
  const extra = Object.keys(parsed.values).filter((o) => !ALLOWED[command].includes(o));
  if (extra.length) return usageError(`${extra.map((o) => `--${o}`).join(', ')} not available for jerome ${command}.`);

  switch (command) {
    case 'new':
      if (rest.length !== 1) return usageError('jerome new takes exactly one name.');
      return newProject(rest[0], { fromFile: parsed.values['from-file'] });
    case 'prompt':
      if (rest.length) return usageError('jerome prompt takes no arguments.');
      return prompt();
    case 'doctor':
      if (rest.length > 1) return usageError('jerome doctor takes at most one folder.');
      return doctor(rest[0] ?? '.', { json: parsed.values.json, check: parsed.values.check });
    case 'update':
      if (rest.length > 1) return usageError('jerome update takes at most one folder.');
      return update(rest[0] ?? '.', { check: parsed.values.check, yes: parsed.values.yes });
    case 'docs':
      if (rest.length > 1) return usageError('jerome docs takes at most one folder.');
      return docs(rest[0] ?? '.');
  }
}

function usageError(message) {
  console.error(`${message}\n\n${USAGE}`);
  return 2;
}
