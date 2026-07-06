/**
 * Human-facing time formatting for emails and notification text.
 *
 * IMPORTANT: this is a PRESENTATION-only helper. The API / socket / DTO contract
 * communicates time as epoch milliseconds and that MUST stay unchanged. These
 * functions only turn an epoch (or Date / numeric string) into readable text for
 * mail bodies and in-app notification messages — never use them to build payload
 * fields that the frontend parses as epoch.
 *
 * The product is Vietnam-only and the rest of the codebase already assumes
 * Asia/Ho_Chi_Minh local time (see TimeHelper.SERVER_TIMEZONE and the reschedule
 * mails), so we format in that zone. Everything is null-safe: a missing or invalid
 * value returns the provided fallback text instead of throwing or printing a raw
 * epoch number.
 */

export const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** Default fallback text when a timestamp is missing/invalid. */
export const DEFAULT_TIME_FALLBACK = 'Thời gian sẽ được xác nhận';
/** Default fallback text when a location/hospital is missing. */
export const DEFAULT_LOCATION_FALLBACK = 'Sẽ được cập nhật';

type DateParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

/** Coerce epoch ms (number / numeric string) or Date into a valid Date, else null. */
function toValidDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    // Epoch milliseconds as a string (10-13 digits) — the common case from DTOs.
    if (/^\d{10,13}$/.test(trimmed)) {
      const date = new Date(Number(trimmed));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function getVietnamParts(date: Date): DateParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: VIETNAM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

/**
 * Format a single timestamp as readable Vietnam local text: "HH:mm dd/MM/yyyy".
 * Returns `fallback` for a missing/invalid value (never throws, never prints epoch).
 */
export function formatVietnamDateTime(
  value: unknown,
  fallback: string = DEFAULT_TIME_FALLBACK,
): string {
  const date = toValidDate(value);
  if (!date) {
    return fallback;
  }
  const p = getVietnamParts(date);
  return `${p.hour}:${p.minute} ${p.day}/${p.month}/${p.year}`;
}

/**
 * Format a start/end window as "HH:mm–HH:mm dd/MM/yyyy" when both ends are known
 * and fall on the same calendar day; otherwise degrade gracefully:
 *  - only one valid end          -> single datetime for that end
 *  - neither valid but fallbackValue given -> single datetime for fallbackValue
 *  - nothing valid               -> `fallback` text
 */
export function formatVietnamTimeRange(
  start: unknown,
  end: unknown,
  fallbackValue?: unknown,
  fallback: string = DEFAULT_TIME_FALLBACK,
): string {
  const startDate = toValidDate(start);
  const endDate = toValidDate(end);

  if (startDate && endDate) {
    const sp = getVietnamParts(startDate);
    const ep = getVietnamParts(endDate);
    const sameDay =
      sp.day === ep.day && sp.month === ep.month && sp.year === ep.year;
    if (sameDay) {
      return `${sp.hour}:${sp.minute}–${ep.hour}:${ep.minute} ${sp.day}/${sp.month}/${sp.year}`;
    }
    return `${sp.hour}:${sp.minute} ${sp.day}/${sp.month}/${sp.year} – ${ep.hour}:${ep.minute} ${ep.day}/${ep.month}/${ep.year}`;
  }

  // Prefer whichever single value we do have: start, then end, then fallbackValue.
  const single = start ?? end ?? fallbackValue;
  return formatVietnamDateTime(single, fallback);
}
