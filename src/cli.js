import { parseArgs } from 'node:util';
import { newProject } from './new.js';
import { doctor } from './doctor.js';

const USAGE = `Uso:
  jerome new <nome>     crea un progetto dal template nella cartella <nome>
  jerome doctor [dir]   ricontrolla setup e profilo snello (default: cartella corrente)`;

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
      if (rest.length !== 1) return usageError('jerome new vuole esattamente un nome.');
      return newProject(rest[0]);
    case 'doctor':
      if (rest.length > 1) return usageError('jerome doctor accetta al massimo una cartella.');
      return doctor(rest[0] ?? '.');
    default:
      return usageError(`Comando sconosciuto: ${command}`);
  }
}

function usageError(message) {
  console.error(`${message}\n\n${USAGE}`);
  return 2;
}
