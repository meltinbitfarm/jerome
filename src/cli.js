import { parseArgs } from 'node:util';
import { newProject } from './new.js';
import { doctor } from './doctor.js';

const USAGE = `Usage:
  jerome new <name>     create a project from the template in the folder <name>
  jerome doctor [dir]   check the setup and restore the lean profile (default: current folder)
    --check             only check and report: write nothing (what external tools should use)
    --json              print a machine-readable report (schema jerome.doctor/v1)`;

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, json: { type: 'boolean' }, check: { type: 'boolean' } } });
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  const [command, ...rest] = parsed.positionals;
  if (parsed.values.help || !command) {
    console.log(USAGE);
    return command || parsed.values.help ? 0 : 2;
  }
  switch (command) {
    case 'new':
      if (parsed.values.json || parsed.values.check) return usageError('--json and --check are only available for jerome doctor.');
      if (rest.length !== 1) return usageError('jerome new takes exactly one name.');
      return newProject(rest[0]);
    case 'doctor':
      if (rest.length > 1) return usageError('jerome doctor takes at most one folder.');
      return doctor(rest[0] ?? '.', { json: parsed.values.json, check: parsed.values.check });
    default:
      return usageError(`Unknown command: ${command}`);
  }
}

function usageError(message) {
  console.error(`${message}\n\n${USAGE}`);
  return 2;
}
