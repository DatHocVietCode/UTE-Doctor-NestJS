// SLA timing for assignment tasks. Values are minutes from env with safe defaults.
// Kept in one place so the scheduler and tests share the same contract.

export const SLA_LOCK_KEY = 'cron:assignment-sla';
// Lock TTL is shorter than the sweep interval so a crashed run cannot wedge the lock
// past the next tick, but long enough to cover a normal sweep.
export const SLA_LOCK_TTL_SECONDS = 50;
// How often the sweep runs (restart-safe: state lives in MongoDB, not timers).
export const SLA_SWEEP_INTERVAL_MS = 60_000;
// Cap per sweep so a backlog cannot blow up a single run.
export const SLA_BATCH_LIMIT = 200;

const MINUTE_MS = 60_000;

function readMinutes(value: unknown, fallbackMinutes: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallbackMinutes;
}

export interface AssignmentSlaConfig {
  reminderWindowMs: number;
  reminderIntervalMs: number;
  graceMs: number;
  acceptTtlMs: number;
}

export function resolveAssignmentSlaConfig(get: (key: string) => unknown): AssignmentSlaConfig {
  return {
    // Start reminding once a task is within this window of its deadline.
    reminderWindowMs: readMinutes(get('ASSIGNMENT_REMINDER_WINDOW_MINUTES'), 10) * MINUTE_MS,
    // Minimum gap between reminders for the same task.
    reminderIntervalMs: readMinutes(get('ASSIGNMENT_REMINDER_INTERVAL_MINUTES'), 5) * MINUTE_MS,
    // Grace period after the deadline before a PENDING task is expired.
    graceMs: readMinutes(get('ASSIGNMENT_GRACE_MINUTES'), 5) * MINUTE_MS,
    // An ASSIGNED task untouched for this long is reclaimed back to PENDING.
    acceptTtlMs: readMinutes(get('ASSIGNMENT_ACCEPT_TTL_MINUTES'), 10) * MINUTE_MS,
  };
}
