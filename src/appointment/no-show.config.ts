// No-show reconciliation timing/config. Values from env with safe defaults.
// Kept in one place so the reconciler, the service core, the read-model derivation,
// and tests share the same contract. See docs/no-show-lifecycle-reconciliation-plan.md.

export const NO_SHOW_LOCK_KEY = 'cron:no-show';
// Lock TTL covers a normal reconciliation pass without wedging past the next run.
export const NO_SHOW_LOCK_TTL_SECONDS = 120;
// Cap per run so a backlog cannot blow up a single pass.
export const NO_SHOW_BATCH_LIMIT = 500;
// Delay after module init before the startup catch-up runs (let the app settle).
export const NO_SHOW_STARTUP_DELAY_MS = 15_000;

const MINUTE_MS = 60_000;

function readMinutes(value: unknown, fallbackMinutes: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallbackMinutes;
}

function readHour(value: unknown, fallbackHour: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 23 ? Math.floor(parsed) : fallbackHour;
}

export interface NoShowConfig {
  // An appointment is overdue once (endTime ?? scheduledAt) + this grace has passed.
  graceMs: number;
  // Local hour (Asia/Ho_Chi_Minh) at which the daily reconciliation runs.
  dailyHour: number;
  // Business-hours window [start,end) in local hours during which patient emails may be sent.
  emailHourStart: number;
  emailHourEnd: number;
}

export function resolveNoShowConfig(get: (key: string) => unknown): NoShowConfig {
  return {
    graceMs: readMinutes(get('NO_SHOW_GRACE_MINUTES'), 120) * MINUTE_MS,
    dailyHour: readHour(get('NO_SHOW_DAILY_HOUR'), 6),
    emailHourStart: readHour(get('NO_SHOW_EMAIL_HOUR_START'), 6),
    emailHourEnd: readHour(get('NO_SHOW_EMAIL_HOUR_END'), 20),
  };
}
