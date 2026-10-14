#!/usr/bin/env node
// Il controllo della versione viene prima di qualsiasi import: i moduli in src/ usano API di Node 24.
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error(`jerome richiede Node ≥ 24, trovato ${process.versions.node}.`);
  process.exit(1);
}

const { main } = await import('../src/cli.js');
process.exitCode = await main(process.argv.slice(2));
