import {
  DEFAULT_TIME_FALLBACK,
  formatVietnamDateTime,
  formatVietnamTimeRange,
} from './human-time.helper';

// 2026-06-22T02:30:00Z === 09:30 in Asia/Ho_Chi_Minh (UTC+7).
const START_EPOCH = Date.UTC(2026, 5, 22, 2, 30, 0);
// 2026-06-22T03:00:00Z === 10:00 in Asia/Ho_Chi_Minh.
const END_EPOCH = Date.UTC(2026, 5, 22, 3, 0, 0);

describe('formatVietnamDateTime', () => {
  it('formats an epoch number as "HH:mm dd/MM/yyyy" in Vietnam local time', () => {
    expect(formatVietnamDateTime(START_EPOCH)).toBe('09:30 22/06/2026');
  });

  it('accepts a Date instance', () => {
    expect(formatVietnamDateTime(new Date(START_EPOCH))).toBe('09:30 22/06/2026');
  });

  it('accepts an epoch passed as a numeric string', () => {
    expect(formatVietnamDateTime(String(START_EPOCH))).toBe('09:30 22/06/2026');
  });

  it('returns the default fallback for null / undefined', () => {
    expect(formatVietnamDateTime(null)).toBe(DEFAULT_TIME_FALLBACK);
    expect(formatVietnamDateTime(undefined)).toBe(DEFAULT_TIME_FALLBACK);
  });

  it('returns the default fallback for invalid input', () => {
    expect(formatVietnamDateTime(Number.NaN)).toBe(DEFAULT_TIME_FALLBACK);
    expect(formatVietnamDateTime('not-a-date')).toBe(DEFAULT_TIME_FALLBACK);
    expect(formatVietnamDateTime({})).toBe(DEFAULT_TIME_FALLBACK);
  });

  it('honours a custom fallback', () => {
    expect(formatVietnamDateTime(null, 'Chưa rõ')).toBe('Chưa rõ');
  });

  it('never returns a raw epoch number in its output', () => {
    const out = formatVietnamDateTime(START_EPOCH);
    expect(out).not.toContain(String(START_EPOCH));
  });
});

describe('formatVietnamTimeRange', () => {
  it('formats a same-day window as "HH:mm–HH:mm dd/MM/yyyy"', () => {
    expect(formatVietnamTimeRange(START_EPOCH, END_EPOCH)).toBe(
      '09:30–10:00 22/06/2026',
    );
  });

  it('falls back to a single datetime when only one end is valid', () => {
    expect(formatVietnamTimeRange(START_EPOCH, null)).toBe('09:30 22/06/2026');
    expect(formatVietnamTimeRange(null, END_EPOCH)).toBe('10:00 22/06/2026');
  });

  it('uses fallbackValue when neither start nor end is valid', () => {
    expect(formatVietnamTimeRange(null, null, START_EPOCH)).toBe(
      '09:30 22/06/2026',
    );
  });

  it('returns the fallback text when nothing is usable', () => {
    expect(formatVietnamTimeRange(null, null)).toBe(DEFAULT_TIME_FALLBACK);
    expect(formatVietnamTimeRange(undefined, undefined, undefined)).toBe(
      DEFAULT_TIME_FALLBACK,
    );
  });
});
