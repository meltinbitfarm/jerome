// The quota governor's pacing (D141): from the real 7-day and 5-hour windows, whether this is the moment to start
// work. A pure function, at zero tokens. The week should end at its target (90%) by its reset: its curve rises evenly
// from the week's start to the reset, and work starts while the week is behind it. A reserve (20%) is left for the
// user's own use, released evenly over the last 24 hours, since what is left at the reset is lost. The 5-hour window
// is a ceiling (90%) and, in its last hour with room to spare, a chance to work a little ahead of the curve. Nothing
// waits for the user to stop working: their use is already in the reading (spec D8).
export const GOVERNOR_DEFAULTS = { target: 90, reserve: 20, fiveHourCap: 90 };
const WEEK_MS = 7 * 86_400_000;
// A reading older than this says too little about now: the governor goes at a reduced pace (spec D11).
export const FRESH_MIN = 30;
const RELEASE_HOURS = 24;
const BURST_MIN = 60;
const BURST_ROOM = 20;
const BURST_LEAD_HOURS = 12;

const round = (x) => Math.round(x * 10) / 10;

// { verdict: go | hold | reduced, kind, why, used, target, ceiling, fiveHour, resetsAt, avoid }. `kind` says why:
// behind, release, burst (go); cap, reserve, ahead (hold); stale (reduced). `avoid` lists the models whose own weekly
// limit is ahead of the curve (spec D9).
export function pace({ windows = {}, readAt = null, scoped = [], settings = GOVERNOR_DEFAULTS, now = new Date() }) {
  const s = { ...GOVERNOR_DEFAULTS, ...settings };
  const week = windows.seven_day;
  const base = { used: week?.used ?? null, target: null, ceiling: null, fiveHour: null, resetsAt: null, avoid: [] };
  const age = readAt ? Math.floor((now.getTime() - readAt.getTime()) / 60_000) : null;
  if (!week || age === null || age > FRESH_MIN) {
    return { ...base, verdict: 'reduced', kind: 'stale', why: age === null || !week ? 'no reading of the subscription windows yet' : `the latest reading of the windows is ${age} min old` };
  }
  const reset = (week.resetsAt ?? 0) * 1000;
  if (reset <= now.getTime()) return { ...base, verdict: 'reduced', kind: 'stale', why: 'the 7-day reading is from before its reset' };
  const curve = (at) => s.target * Math.min(1, Math.max(0, (at - (reset - WEEK_MS)) / WEEK_MS));
  const hoursLeft = (reset - now.getTime()) / 3_600_000;
  const target = round(curve(now.getTime()));
  const ceiling = round(100 - s.reserve * Math.min(1, hoursLeft / RELEASE_HOURS));
  const five = windows.five_hour;
  const fiveLive = five && (five.resetsAt ?? 0) * 1000 > now.getTime();
  const fiveUsed = fiveLive ? five.used : 0;
  const avoid = scoped.filter((x) => x.used >= target && x.used > 0).map((x) => x.model);
  const out = { used: week.used, target, ceiling, fiveHour: fiveUsed, resetsAt: new Date(reset).toISOString(), avoid };
  const resetText = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  if (fiveUsed >= s.fiveHourCap) return { ...out, verdict: 'hold', kind: 'cap', why: `5h ${fiveUsed}% ≥ ${s.fiveHourCap}%, resets ${resetText(five.resetsAt * 1000)} UTC` };
  if (week.used >= ceiling) return { ...out, verdict: 'hold', kind: 'reserve', why: `7d ${week.used}% ≥ ${ceiling}%: the rest is kept for you` };
  if (week.used < target) return { ...out, verdict: 'go', kind: 'behind', why: `7d ${week.used}% behind its pace, ${target}%` };
  if (hoursLeft <= RELEASE_HOURS) return { ...out, verdict: 'go', kind: 'release', why: `7d ${week.used}%, ${Math.round(hoursLeft)} h to the reset: what is left would be lost` };
  const fiveSoon = fiveLive && five.resetsAt * 1000 - now.getTime() <= BURST_MIN * 60_000;
  if (fiveSoon && fiveUsed < s.fiveHourCap - BURST_ROOM && week.used < curve(now.getTime() + BURST_LEAD_HOURS * 3_600_000)) {
    return { ...out, verdict: 'go', kind: 'burst', why: `5h ${fiveUsed}% resets within the hour, 7d ${week.used}% close to its pace` };
  }
  return { ...out, verdict: 'hold', kind: 'ahead', why: `7d ${week.used}% ahead of its pace, ${target}%` };
}

// A model the run should not use while its own weekly limit is ahead (spec D9): matched by name, "Fable" in
// "claude-fable-5-1" or "fable". Returns the model to use and why it changed, or null.
export function modelFor(model, avoid = []) {
  const m = String(model ?? '').toLowerCase();
  const hit = avoid.find((name) => m.includes(String(name).toLowerCase()));
  if (!hit || m.includes('sonnet')) return null;
  return { model: 'sonnet', why: `model sonnet: ${hit}'s weekly limit is ahead of its pace` };
}
