// Reading briefs for `jerome new --from-file` (D29, D35). The contract is the brief/v2 format (D34):
// a valid brief/v2 or brief/v1 is sorted into the project files here, without the model; anything else
// is saved as it is and left to the lead agent, through a provisional PROJECT.md.

// Sections of brief/v2, in the order they are written to the project files.
const V2_SECTIONS = [
  'Goal', 'Context', 'Constraints', 'Decisions', 'Agent limits', 'Tools', 'Pace and usage',
  'Open questions', 'Parked', 'Out of scope', 'Success',
];
const OPTIONAL = new Set(['Tools', 'Pace and usage']);
const PROJECT_SECTIONS = ['Goal', 'Context', 'Constraints', 'Agent limits', 'Tools', 'Pace and usage', 'Out of scope', 'Success'];

// brief/v1 had the same structure with Italian headings (references/brief-v2.md, "Reading brief/v1").
const V1_HEADINGS = {
  Obiettivo: 'Goal', Contesto: 'Context', Vincoli: 'Constraints', Decisioni: 'Decisions',
  'Limiti agenti': 'Agent limits', Strumenti: 'Tools', 'Ritmo e consumi': 'Pace and usage',
  'Domande aperte': 'Open questions', Parcheggiate: 'Parked', 'Fuori scope': 'Out of scope', Successo: 'Success',
};

// The first line of a provisional PROJECT.md: `jerome doctor` recognizes it by this marker.
export const PROVISIONAL_MARKER = '<!-- jerome:provisional -->';

// Removes the code fences that the chats' "copy" buttons put around a brief. If the text holds fenced blocks,
// the first one that starts with front matter is the brief; a text that is one fenced block is unwrapped.
export function stripFences(text) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const blocks = [...normalized.matchAll(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1[ \t]*$/gm)];
  const withFrontMatter = blocks.find((m) => m[2].trimStart().startsWith('---\n'));
  if (withFrontMatter) return withFrontMatter[2].trim();
  if (blocks.length === 1 && blocks[0][0] === normalized) return blocks[0][2].trim();
  return normalized;
}

// Returns one of:
//   { kind: 'brief', format, meta, sections, ignored }  a valid brief/v2, or a brief/v1 mapped to v2 headings;
//                                                        `ignored` lists the stray text left out, as warnings
//   { kind: 'unknown-format', format }         a declared format this version cannot read
//   { kind: 'text', reasons }                  anything else, with the reasons it is not a valid brief
export function parseBrief(input) {
  // Chats often put a sentence before the brief: the front matter is the first `---` block with a format line,
  // and the text before it is left out with a warning.
  const fm = [...input.matchAll(/^---\n([\s\S]*?)\n---[ \t]*$/gm)].find((m) => /^format:/m.test(m[1]))
    ?? input.match(/^---\n([\s\S]*?)\n---[ \t]*$/m);
  if (!fm) return { kind: 'text', reasons: ['no front matter'] };
  const ignored = [];
  const preamble = input.slice(0, fm.index).trim();
  if (preamble) ignored.push(`text before the front matter: "${excerpt(preamble)}"`);
  const meta = {};
  for (const line of fm[1].split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*?)\s*(?:#.*)?$/);
    if (m) meta[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  const format = meta.format;
  if (!format) return { kind: 'text', reasons: ['no format field in the front matter'] };
  if (format !== 'brief/v2' && format !== 'brief/v1') {
    return /^brief\/v\d+$/.test(format) ? { kind: 'unknown-format', format } : { kind: 'text', reasons: [`format "${format}" is not a brief format`] };
  }

  const reasons = [];
  if (!meta.name) reasons.push('no name field in the front matter');
  const sections = {};
  const body = input.slice(fm.index + fm[0].length);
  const parts = body.split(/^## +(.+?)[ \t]*$/m);
  if (parts[0].trim()) ignored.push(`text before the first section: "${excerpt(parts[0].trim())}"`);
  for (let i = 1; i < parts.length; i += 2) {
    const heading = format === 'brief/v1' ? (V1_HEADINGS[parts[i]] ?? parts[i]) : parts[i];
    if (!V2_SECTIONS.includes(heading)) reasons.push(`unexpected section "${parts[i]}"`);
    else if (heading in sections) reasons.push(`section "${parts[i]}" appears twice`);
    else sections[heading] = parts[i + 1].trim();
  }
  for (const s of V2_SECTIONS) {
    if (!OPTIONAL.has(s) && !(s in sections)) reasons.push(`missing section "${s}"`);
  }
  return reasons.length ? { kind: 'text', reasons } : { kind: 'brief', format, meta, sections, ignored };
}

function excerpt(text) {
  const line = text.replace(/\s+/g, ' ');
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

// Sorts a parsed brief into the project files, following the "Import" table of references/brief-v2.md.
export function projectFiles(brief) {
  const { meta, sections } = brief;
  const block = (s) => `## ${s}\n${sections[s] || 'none'}\n`;
  const project = PROJECT_SECTIONS.filter((s) => !OPTIONAL.has(s) || sections[s]).map(block);
  return {
    'PROJECT.md': `# ${meta.name}\n\n${project.join('\n')}`,
    'decisions.md': `# Decisions\n\n${sections.Decisions || 'none'}\n`,
    'open.md': `# Open\n\n${block('Open questions')}\n${block('Parked')}`,
  };
}

// The provisional PROJECT.md written when the brief is free text (D35). It is loaded at startup like any
// PROJECT.md, so the lead agent sees the instruction in the first session without CLAUDE.md growing.
export function provisionalProject(reasons) {
  return `${PROVISIONAL_MARKER}
# Provisional project

\`brief.md\` is not a valid brief/v2 (${reasons.join('; ')}).
Before any other task, convert it with the project-brief skill ("PROJECT.md is provisional"): list the decisions you find and have the user confirm them in one block before recording anything, then write PROJECT.md, decisions.md and open.md, replacing this file. Leave brief.md as it is.
`;
}

export function isProvisional(content) {
  return content.startsWith(PROVISIONAL_MARKER);
}
