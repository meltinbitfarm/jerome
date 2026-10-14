import { parseArgs } from 'node:util';
import { newProject } from './new.js';
import { doctor } from './doctor.js';

const USAGE = `Usage:
  jerome new <name>     create a project from the template in the folder <name>
  jerome doctor [dir]   check the setup and the lean profile (default: current folder)`;

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { help: { type: 'boolean', short: 'h' } } });
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
      if (rest.length !== 1) return usageError('jerome new takes exactly one name.');
      return newProject(rest[0]);
    case 'doctor':
      if (rest.length > 1) return usageError('jerome doctor takes at most one folder.');
      return doctor(rest[0] ?? '.');
    default:
      return usageError(`Unknown command: ${command}`);
  }
}

function usageError(message) {
  console.error(`${message}\n\n${USAGE}`);
  return 2;
}
