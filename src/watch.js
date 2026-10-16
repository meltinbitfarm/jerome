// Pages an area follows (D111): listed on a `- Watch:` line of its `## Area: <name>` section in scope.md. With
// `Trigger: watch` in areas.md, the area is due only when one of them changed since its last heartbeat. The CLI
// fetches each page's markdown at zero tokens, only from the domains the project's WebFetch rules allow, saves it
// in .jerome/watch/ for the area's agents to read whole with Read (WebFetch returns summaries), and keeps the
// hashes in the cache, saved only once a heartbeat on the area ends done.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { STATE, JEROME_DIR } from './paths.js';
import { section } from './areas.js';

export const WATCH_DIR = `${JEROME_DIR}/watch`;
const FETCH_MS = 20_000;

// The URLs on the area's Watch line, in scope.md.
export function watchedPages(dir, area) {
  const path = join(dir, STATE.scope);
  if (!existsSync(path)) return [];
  const line = section(readFileSync(path, 'utf8'), `Area: ${area}`).split('\n').find((l) => /^- *Watch:/.test(l));
  return line ? line.replace(/^- *Watch:/, '').split(',').map((u) => u.trim()).filter(Boolean) : [];
}

// The domains the project's WebFetch rules allow, from its shared and local settings.
export function allowedDomains(dir) {
  const domains = new Set();
  for (const file of ['settings.json', 'settings.local.json']) {
    try {
      const allow = JSON.parse(readFileSync(join(dir, '.claude', file), 'utf8')).permissions?.allow ?? [];
      for (const rule of allow) {
        const m = String(rule).match(/^WebFetch\(domain:([^)\s]+)\)$/);
        if (m) domains.add(m[1].toLowerCase());
      }
    } catch {
      // A missing or unreadable file allows nothing.
    }
  }
  return domains;
}

function hashesPath(label) {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'jerome', 'watch', `${label}.json`);
}

function readHashes(label) {
  try {
    return JSON.parse(readFileSync(hashesPath(label), 'utf8'));
  } catch {
    return {};
  }
}

// Where a page's markdown is saved in the project: .jerome/watch/<host>/<path>.md.
export function savedPath(url) {
  const u = new URL(url);
  const rest = u.pathname.replace(/\/+$/, '').replace(/\.md$/, '') || '/index';
  return `${WATCH_DIR}/${u.host}${rest}.md`;
}

// Checks one area's pages: { changed, files, outside, unreachable, pending }. `pending` is what to save once the
// heartbeat on this area ends done.
export async function checkPages(dir, area, label, { fetchPage = fetchMarkdown } = {}) {
  const urls = watchedPages(dir, area);
  const domains = allowedDomains(dir);
  const outside = [];
  const files = [];
  const pending = {};
  const known = readHashes(label)[area] ?? {};
  let changed = false;
  for (const url of urls) {
    let host;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      outside.push(url);
      continue;
    }
    if (!domains.has(host)) {
      outside.push(url);
      continue;
    }
    let text;
    try {
      text = await fetchPage(url);
    } catch {
      return { changed: false, files, outside, unreachable: url, pending };
    }
    const file = savedPath(url);
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    // The folder keeps itself out of git: the pages are a copy, refreshed at every check.
    if (!existsSync(join(dir, WATCH_DIR, '.gitignore'))) writeFileSync(join(dir, WATCH_DIR, '.gitignore'), '*\n');
    writeFileSync(join(dir, file), text);
    files.push(file);
    pending[url] = createHash('sha256').update(text).digest('hex');
    if (known[url] !== pending[url]) changed = true;
  }
  return { changed, files, outside, unreachable: null, pending };
}

export function saveHashes(label, area, pending) {
  const path = hashesPath(label);
  const all = readHashes(label);
  all[area] = { ...(all[area] ?? {}), ...pending };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
}

// A page's markdown version: `<url>.md`, as documentation sites built for models serve it.
async function fetchMarkdown(url) {
  const target = url.endsWith('.md') ? url : `${url.replace(/\/+$/, '')}.md`;
  const res = await fetch(target, { signal: AbortSignal.timeout(FETCH_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status}`);
  return await res.text();
}
