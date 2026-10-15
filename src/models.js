// API list prices per million tokens, used to estimate what usage would cost on the API (D20). A subscription
// is not billed this way: every amount is shown as an API equivalent ("≈$3.40 API"), never as a cost.
// Source: platform.claude.com/docs/en/about-claude/pricing, read on 2026-10-15. Fast mode and US-only inference
// multipliers are not applied.
export const PRICES_DATE = '2026-10-15';

const PRICES = {
  'claude-opus-5-5': { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, write5m: 2.5, write1h: 4, read: 0.1, output: 10 },
  // Haiku 5.5 has two tiers, by the size of the prompt (input, cache reads and cache writes).
  'claude-haiku-5-5': { input: 0.1, write5m: 0.125, write1h: 0.2, read: 0.01, output: 0.5 },
  'claude-haiku-5-5@long': { input: 0.5, write5m: 0.625, write1h: 1, read: 0.05, output: 2.5 },
  'claude-fable-5-1': { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 },
};
const HAIKU_LONG_PROMPT = 100_000;

// Haiku 5.5's tier depends on the prompt of each call, so sums must be grouped by it before pricing: summing calls
// first would put many short prompts in the long tier. Add `TIER_SQL AS long_prompt` to the SELECT and GROUP BY it.
export const TIER_SQL = `(model LIKE 'claude-haiku-5-5%' AND input + cache_read + cache_write_5m + cache_write_1h > ${HAIKU_LONG_PROMPT})`;

// The API-equivalent price of one call, or of calls summed within one tier (u.long_prompt from TIER_SQL), in
// dollars, or null for a model not in the table.
export function callPrice(model, u) {
  const base = model.replace(/\[.*\]$/, '');
  const prompt = u.input + u.cache_read + u.cache_write_5m + u.cache_write_1h;
  const long = u.long_prompt === undefined ? prompt > HAIKU_LONG_PROMPT : Boolean(u.long_prompt);
  const p = base === 'claude-haiku-5-5' && long ? PRICES['claude-haiku-5-5@long'] : PRICES[base];
  if (!p) return null;
  return (u.input * p.input + u.output * p.output + u.cache_read * p.read + u.cache_write_5m * p.write5m + u.cache_write_1h * p.write1h) / 1e6;
}

export function knownModel(model) {
  return model.replace(/\[.*\]$/, '') in PRICES;
}
