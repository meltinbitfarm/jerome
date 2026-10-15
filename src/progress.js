// A progress line for the commands that wait on Claude Code (D79): a spinner, the elapsed time and the action in
// progress, read from the stream when there is one. It is drawn on standard error, on one line that is rewritten
// and cleared at the end, and only when standard error is a terminal: logs, pipes and `--json` output stay clean.
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function startProgress(label, { stream = process.stderr, env = process.env } = {}) {
  const live = Boolean(stream.isTTY) && !env.CI && env.JEROME_PROGRESS !== 'off';
  const start = Date.now();
  let action = label;
  let frame = 0;
  let timer = null;
  const draw = () => {
    const s = Math.floor((Date.now() - start) / 1000);
    const elapsed = s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
    const text = `${FRAMES[frame++ % FRAMES.length]} ${elapsed} · ${action}`;
    stream.write(`\r${text.slice(0, Math.max(20, (stream.columns || 80) - 1))}\x1b[K`);
  };
  if (live) {
    draw();
    timer = setInterval(draw, 100);
  }
  return {
    live,
    update(next) {
      if (next) action = next;
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      stream.write('\r\x1b[K');
    },
  };
}

// What a stream-json event says the session is doing, in a few words, or null.
export function actionOf(event) {
  if (event?.type !== 'assistant') return null;
  const content = event.message?.content ?? [];
  const tool = [...content].reverse().find((c) => c.type === 'tool_use');
  if (tool) return describeTool(tool.name, tool.input ?? {});
  return content.some((c) => c.type === 'text' && c.text?.trim()) ? 'writing the reply' : 'thinking';
}

export function describeTool(name, input) {
  const short = (s) => {
    const one = String(s ?? '').replace(/\s+/g, ' ').trim();
    return one.length > 60 ? `${one.slice(0, 57)}...` : one;
  };
  const file = (p) => short(String(p ?? '').split('/').slice(-2).join('/'));
  if (name === 'Read') return `reading ${file(input.file_path)}`;
  if (name === 'Edit' || name === 'NotebookEdit') return `editing ${file(input.file_path)}`;
  if (name === 'Write') return `writing ${file(input.file_path)}`;
  if (name === 'Bash') return `running ${short(input.description || input.command)}`;
  if (name === 'Grep' || name === 'Glob') return `searching ${short(input.pattern)}`;
  if (name === 'Agent' || name === 'Task') return `delegating to ${short(input.subagent_type || 'a subagent')}`;
  if (name === 'Skill') return `using the ${short(input.skill)} skill`;
  return `using ${name}`;
}
