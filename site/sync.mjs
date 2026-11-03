// Copies the documentation into src/ for VitePress: docs/ as it is, the README as the introduction. The Markdown in
// the repository stays the only source: links that leave docs/ (PLAN.md, the code, the template) become links to the
// file on GitHub, links to the README become links to the introduction, and the rest stay as written.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(import.meta.dirname, 'src');
const GITHUB = 'https://github.com/meltinbitfarm/jerome';

// Where each page of the site comes from, as repository paths.
const pages = new Map([['introduction.md', 'README.md']]);
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((name) => {
  const path = posix.join(dir, name);
  if (statSync(join(ROOT, path)).isDirectory()) return name === 'assets' ? [] : walk(path);
  return name.endsWith('.md') ? [path] : [];
});
// A folder's README.md is its index page on the site.
const sitePath = (docsPath) => docsPath.replace(/(^|\/)README\.md$/, '$1index.md');
for (const path of walk('docs')) pages.set(sitePath(path.slice('docs/'.length)), path);

// The repository path a link points to, seen from the page's own repository path.
function rewrite(target, from, to) {
  if (/^([a-z]+:|#|\/)/i.test(target)) return target;
  const [path, hash = ''] = target.split('#');
  const resolved = posix.normalize(posix.join(posix.dirname(from), path));
  const anchor = hash ? `#${hash}` : '';
  const here = posix.dirname(to);
  if (resolved === 'README.md') return `${here === '.' ? './' : `${posix.relative(here, '.')}/`}introduction.md${anchor}`;
  if (resolved.startsWith('docs/')) {
    const rel = posix.relative(here, sitePath(resolved.slice('docs/'.length))) || '.';
    // Vite reads a path without ./ or ../ as a package's name.
    return `${rel.startsWith('.') ? rel : `./${rel}`}${anchor}`;
  }
  const isDir = (() => { try { return statSync(join(ROOT, resolved)).isDirectory(); } catch { return false; } })();
  return `${GITHUB}/${isDir ? 'tree' : 'blob'}/main/${resolved}${anchor}`;
}

rmSync(SRC, { recursive: true, force: true });
mkdirSync(SRC, { recursive: true });
// The site's own pages (the home page) live in pages/, copied first.
cpSync(join(import.meta.dirname, 'pages'), SRC, { recursive: true });
cpSync(join(ROOT, 'docs', 'assets'), join(SRC, 'assets'), { recursive: true });
// And under public/ too, for what the config and the home page name by address: the logo, the hero's picture.
cpSync(join(ROOT, 'docs', 'assets'), join(SRC, 'public', 'assets'), { recursive: true });
for (const [to, from] of pages) {
  let text = readFileSync(join(ROOT, from), 'utf8');
  // Links in Markdown, and the src and href of the HTML the README uses for its picture; code is left as it is.
  text = text.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => (i % 2 ? part : part
    .replace(/\]\(([^)\s]+)\)/g, (_, t) => `](${rewrite(t, from, to)})`)
    .replace(/\b(src|href)="([^"]+)"/g, (_, attr, t) => `${attr}="${rewrite(t, from, to)}"`))).join('');
  mkdirSync(dirname(join(SRC, to)), { recursive: true });
  writeFileSync(join(SRC, to), text);
}
console.log(`docs site: ${pages.size} pages copied into ${relative(process.cwd(), SRC) || 'src'}`);
