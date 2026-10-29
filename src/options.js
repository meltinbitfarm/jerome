// A decision request's options, read the same way by the Telegram bridge and the Director's dashboard (D183, D191).

// A request's options as buttons, however the agent wrote them: labelled in order ("A) …", "B: …", "1) …"), split at
// the labels, so a "/" or ";" inside an option stays in it; else separated by " / ", ";", " | " or " · ". Fewer than
// two, or more than six, gives none.
export function optionList(options) {
  const text = String(options ?? '').trim();
  const list = labelled(text) ?? text.split(/\s+\/\s+|\s*;\s*|\s+\|\s+|\s+·\s+/);
  const out = list.map((o) => o.trim()).filter(Boolean);
  return out.length >= 2 && out.length <= 6 ? out : [];
}

// The options split at their labels A, B, C… or 1, 2, 3…, when the text starts with the first and has the next in
// order; the separator before each label is left out.
function labelled(text) {
  const first = text.match(/^([A-Z]|1)[):]\s/);
  if (!first) return null;
  const next = (label) => (/\d/.test(label) ? String(Number(label) + 1) : String.fromCharCode(label.charCodeAt(0) + 1));
  const starts = [0];
  let label = first[1];
  for (;;) {
    label = next(label);
    const at = text.slice(starts.at(-1) + 3).search(new RegExp(`(^|[\\s;·|/,])${label}[):]\\s`));
    if (at < 0) break;
    const from = starts.at(-1) + 3 + at;
    starts.push(from + text.slice(from).indexOf(label));
  }
  if (starts.length < 2) return null;
  return starts.map((at, i) => text.slice(at, starts[i + 1] ?? text.length).replace(/[\s;·|/,]+$/, ''));
}
