#!/usr/bin/env node
// The version check comes before any import: the modules in src/ use Node 24 APIs.
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error(`jerome requires Node ≥ 24, found ${process.versions.node}.`);
  process.exit(1);
}

// node:sqlite still prints an ExperimentalWarning on Node 24. Only that warning is dropped, so the output of hooks
// and of `--json` stays clean; every other warning is printed as usual (D54).
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
  console.error(`(node) ${warning.name}: ${warning.message}`);
});

const { main } = await import('../src/cli.js');
process.exitCode = await main(process.argv.slice(2));
