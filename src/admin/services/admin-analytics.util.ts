// Pure helpers for the admin analytics endpoints. Kept free of Mongoose/Nest so the
// real logic (time windows, limit clamping, null-safe patient mapping) is unit-testable.

export interface AnalyticsWindow {
  from: number | null;
  to: number | null;
}

// Parse a raw epoch-ms query value to a finite number, else undefined.
export function parseEpoch(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Scheduled-metric window (reqs 1/2/4). When BOTH bounds are absent, default to the
// last `months` calendar months → now. Otherwise honor the explicit bounds (either may
// be open). `now` is injected for testability.
export function computeScheduledWindow(from: unknown, to: unknown, now: number, months = 3): AnalyticsWindow {
  const f = parseEpoch(from);
  const t = parseEpoch(to);
  if (f === undefined && t === undefined) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - months);
    return { from: d.getTime(), to: now };
  }
  return { from: f ?? null, to: t ?? null };
}

// Review-metric window (req 3). All-time (null/null) when BOTH bounds are absent;
// otherwise honor the explicit bounds. Diverges from the scheduled window by design.
export function computeReviewWindow(from: unknown, to: unknown): AnalyticsWindow {
  const f = parseEpoch(from);
  const t = parseEpoch(to);
  if (f === undefined && t === undefined) return { from: null, to: null };
  return { from: f ?? null, to: t ?? null };
}

// Build a Mongo range match fragment for a timestamp field. Empty object for all-time.
export function windowMatch(field: string, w: AnalyticsWindow): Record<string, any> {
  const range: Record<string, number> = {};
  if (w.from !== null) range.$gte = w.from;
  if (w.to !== null) range.$lte = w.to;
  return Object.keys(range).length ? { [field]: range } : {};
}

// Build a Mongo range match fragment for a Date-typed timestamp field (e.g.
// Billing.createdAt, which is a real Date via `timestamps: true` — unlike scheduledAt,
// which is stored as epoch-ms). Bounds must be wrapped in `new Date(...)` or a Mongo
// $gte/$lte comparison against a Date field silently matches nothing. Empty object for all-time.
export function windowMatchDate(field: string, w: AnalyticsWindow): Record<string, any> {
  const range: Record<string, Date> = {};
  if (w.from !== null) range.$gte = new Date(w.from);
  if (w.to !== null) range.$lte = new Date(w.to);
  return Object.keys(range).length ? { [field]: range } : {};
}

// Clamp a raw limit to [min, max], defaulting when missing/invalid.
export function clampLimit(raw: unknown, def = 5, min = 1, max = 50): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// Req-5-compliant, null-safe projection of a frequent-patient aggregation row:
// only name + active/inactive status + the accountId handle + the exam count are ever
// exposed. Unresolvable patientId (the known integrity landmine) yields nulls, never a throw.
export interface FrequentPatientItem {
  accountId: string | null;
  name: string | null;
  status: string | null;
  examCount: number;
}

export function mapFrequentPatientRow(row: any): FrequentPatientItem {
  const accountId = row?.account?._id
    ? String(row.account._id)
    : row?.patient?.accountId
      ? String(row.patient.accountId)
      : null;
  return {
    accountId,
    name: row?.profile?.name ?? null,
    status: row?.account?.status ?? null,
    examCount: row?.examCount ?? 0,
  };
}
