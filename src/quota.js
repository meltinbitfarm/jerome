// The subscription's real quota (D140), the only module that knows where it is read: Claude Code's usage endpoint,
// which is not documented and may change (spec V4). It answers for the account, so it includes the user's own use of
// claude.ai and Claude Code. The token is Claude Code's login: read where Claude Code keeps it, sent only to that
// endpoint, never logged, printed, stored or renewed here (D139); renewing it would rotate it under Claude Code. When
// it has expired, or the endpoint does not answer, the readings of the status line and of the runs' streams remain.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readAccount, recordWindows, writeAccount } from './account.js';

export const QUOTA_URL = 'https://api.anthropic.com/api/oauth/usage';
// How often the endpoint is asked at most: the watchdog passes every minute, the windows move slowly.
export const QUOTA_EVERY_MIN = 5;
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

// Claude Code's login, { token, expiresAt } or { error }: the macOS Keychain, else .credentials.json in its folder.
function login(env) {
  let raw;
  try {
    if (process.platform === 'darwin') raw = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
    else {
      const file = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), '.credentials.json');
      if (!existsSync(file)) return { error: 'no Claude Code login on this machine' };
      raw = readFileSync(file, 'utf8');
    }
  } catch {
    return { error: 'the Claude Code login could not be read from the Keychain' };
  }
  let oauth;
  try {
    oauth = JSON.parse(raw).claudeAiOauth;
  } catch {
    return { error: 'the Claude Code login is unreadable' };
  }
  if (!oauth?.accessToken) return { error: 'Claude Code is not logged in with a subscription' };
  if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now()) return { error: 'the Claude Code login has expired; Claude Code renews it when it next runs' };
  return { token: oauth.accessToken };
}

const seconds = (iso) => (iso ? Math.round(Date.parse(iso) / 1000) : null);

// The endpoint's answer as Jérôme reads it: the 5-hour and 7-day windows like account.json's (used %, resetsAt in
// seconds), the weekly limits scoped to one model, and the week's share by surface (Claude Code, chat).
export function parseUsage(body) {
  const windows = {};
  for (const name of ['five_hour', 'seven_day']) {
    const w = body?.[name];
    if (typeof w?.utilization === 'number') windows[name] = { used: Math.round(w.utilization), resetsAt: seconds(w.resets_at) };
  }
  const scoped = (body?.limits ?? []).filter((l) => l?.kind === 'weekly_scoped' && l.scope?.model?.display_name)
    .map((l) => ({ model: l.scope.model.display_name, used: Math.round(l.percent ?? 0), resetsAt: seconds(l.resets_at) }));
  const breakdown = (body?.seven_day_breakdown?.rows ?? []).map((r) => ({ key: r.key, name: r.display_name, percent: r.percent }));
  return { windows, scoped, breakdown };
}

// One reading, or { error }. JEROME_QUOTA_FAKE names a file holding the endpoint's answer, for the tests.
export async function fetchQuota({ env = process.env } = {}) {
  let body;
  if (env.JEROME_QUOTA_FAKE) {
    try {
      body = JSON.parse(readFileSync(env.JEROME_QUOTA_FAKE, 'utf8'));
    } catch {
      return { error: 'the usage endpoint did not answer' };
    }
  } else {
    const auth = login(env);
    if (auth.error) return auth;
    try {
      const r = await fetch(QUOTA_URL, { headers: { Authorization: `Bearer ${auth.token}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return { error: `the usage endpoint answered ${r.status}` };
      body = await r.json();
    } catch (err) {
      return { error: `the usage endpoint did not answer: ${err.message}` };
    }
  }
  const reading = parseUsage(body);
  if (!reading.windows.seven_day) return { error: 'the usage endpoint answered without the 7-day window: its format may have changed' };
  return reading;
}

// A reading recorded in account.json: the windows beside the other sources' (source "oauth"), and under `quota` when
// it was read, the scoped limits, the breakdown, and the last error. Asked at most every QUOTA_EVERY_MIN minutes
// unless forced. Returns the account as it now stands.
export async function refreshQuota({ env = process.env, now = new Date(), force = false } = {}) {
  const account = readAccount();
  const last = account.quota?.attemptAt ? Date.parse(account.quota.attemptAt) : 0;
  if (!force && now.getTime() - last < QUOTA_EVERY_MIN * 60_000) return account;
  const reading = await fetchQuota({ env });
  if (!reading.error) recordWindows(reading.windows, { source: 'oauth', now });
  const after = readAccount();
  after.quota = reading.error
    ? { ...after.quota, attemptAt: now.toISOString(), error: reading.error }
    : { attemptAt: now.toISOString(), readAt: now.toISOString(), error: null, scoped: reading.scoped, breakdown: reading.breakdown };
  writeAccount(after);
  return after;
}

// When the windows were last known to be right: the endpoint's last answer, or the newest reading of another source.
export function readingTime(account) {
  const times = [account.quota?.readAt, ...Object.values(account.windows ?? {}).map((w) => w.readAt)].filter(Boolean).map((t) => Date.parse(t));
  return times.length ? new Date(Math.max(...times)) : null;
}
