#!/usr/bin/env node
// The version check comes before any import: the modules in src/ use Node 24 APIs.
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error(`jerome requires Node ≥ 24, found ${process.versions.node}.`);
  process.exit(1);
}

const { main } = await import('../src/cli.js');
process.exitCode = await main(process.argv.slice(2));
