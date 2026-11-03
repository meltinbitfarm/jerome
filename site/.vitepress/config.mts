// The documentation site: the pages of docs/ and the README, copied into src/ by sync.mjs, published on GitHub Pages.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { withMermaid } from 'vitepress-plugin-mermaid';

const DOCS = join(import.meta.dirname, '..', '..', 'docs');
// A page's title in the sidebar: its first heading, without the backticks a command's name has.
const titleOf = (path) => (readFileSync(join(DOCS, path), 'utf8').match(/^# (.+)$/m)?.[1] ?? path).replace(/`/g, '');
const item = (path, text = titleOf(path)) => ({ text, link: `/${path.replace(/\.md$/, '')}` });
const commands = readdirSync(join(DOCS, 'commands')).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()
  .map((f) => item(`commands/${f}`, `jerome ${f.replace(/\.md$/, '')}`));

export default withMermaid({
  title: 'Jérôme',
  description: 'Your projects keep moving while you are away, on the Claude subscription you already pay for.',
  base: '/jerome/',
  srcDir: 'src',
  cleanUrls: true,
  lastUpdated: false,
  head: [['link', { rel: 'icon', href: '/jerome/assets/jerome.png' }]],
  themeConfig: {
    logo: '/assets/jerome.png',
    nav: [
      { text: 'Get started', link: '/introduction' },
      { text: 'Diagrams', link: '/diagrams' },
      { text: 'Commands', link: '/commands/' },
      { text: 'Director', link: '/director' },
    ],
    sidebar: [
      { text: 'Getting started', items: [item('introduction.md', 'Introduction'), item('why.md'), item('diagrams.md'), item('guide.md'), item('roadmap.md')] },
      { text: 'A project', items: ['lead-agent.md', 'agents.md', 'areas.md', 'project-brief.md', 'board.md', 'configuration.md'].map((p) => item(p)) },
      { text: 'On its own', items: ['heartbeat.md', 'limits.md', 'quota-governor.md', 'telegram.md', 'director.md', 'migrating-heartbeat-scripts.md'].map((p) => item(p)) },
      { text: 'How it is built', collapsed: true, items: ['lean-profile.md', 'project-layout.md', 'memory-format.md', 'database.md', 'usage-data.md', 'hooks.md', 'token-lessons.md', 'repository-layout.md'].map((p) => item(p)) },
      { text: 'Commands', collapsed: true, items: [{ text: 'All the commands', link: '/commands/' }, ...commands] },
      { text: 'Specs', collapsed: true, items: ['specs/autonomy.md', 'specs/unblock.md', 'specs/quota-governor.md', 'specs/director.md'].map((p) => item(p)) },
    ],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    socialLinks: [{ icon: 'github', link: 'https://github.com/meltinbitfarm/jerome' }],
    // Each page is edited where it lives: docs/, or the README for the introduction.
    editLink: {
      pattern: ({ filePath }) => `https://github.com/meltinbitfarm/jerome/edit/main/${filePath === 'introduction.md' ? 'README.md' : `docs/${filePath.replace(/(^|\/)index\.md$/, '$1README.md')}`}`,
      text: 'Edit this page on GitHub',
    },
    footer: { message: 'MIT License', copyright: 'Jérôme, by Meltinbit' },
  },
  mermaid: {},
});
