// A text that leaves a Mac for the Director (D147): no path, so no user name or folder layout. Each absolute path
// becomes `…/` and its last name, and line breaks become spaces.
const PATH = /\/(?:Users|home|private|var|tmp|Volumes|opt)\/[^\s'"`()<>,;]*/g;

export function scrub(text) {
  return String(text ?? '').replace(PATH, (p) => `…/${p.replace(/\/+$/, '').split('/').pop()}`).replace(/\s+/g, ' ').trim();
}
