// Loaded before every test file (`node --test --import`): the tests that run Jérôme in their own process write
// the store, the backups and the account settings under a temporary folder, never under the real home.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'jerome-home-'));
for (const [name, sub] of [['XDG_DATA_HOME', 'data'], ['XDG_CACHE_HOME', 'cache'], ['XDG_CONFIG_HOME', 'config']]) {
  process.env[name] ??= join(home, sub);
}
