import {
  clampLimit,
  computeReviewWindow,
  computeScheduledWindow,
  mapFrequentPatientRow,
  parseEpoch,
  windowMatch,
  windowMatchDate,
} from './admin-analytics.util';

describe('admin-analytics.util', () => {
  describe('parseEpoch', () => {
    it('returns undefined for empty/invalid, number for valid', () => {
      expect(parseEpoch(undefined)).toBeUndefined();
      expect(parseEpoch('')).toBeUndefined();
      expect(parseEpoch('abc')).toBeUndefined();
      expect(parseEpoch('1710000000000')).toBe(1710000000000);
      expect(parseEpoch(1710000000000)).toBe(1710000000000);
    });
  });

  describe('computeScheduledWindow (reqs 1/2/4)', () => {
    it('defaults to the last 3 calendar months → now when both bounds absent', () => {
      const now = Date.UTC(2026, 6, 11);
      const d = new Date(now);
      d.setMonth(d.getMonth() - 3);
      expect(computeScheduledWindow(undefined, undefined, now)).toEqual({ from: d.getTime(), to: now });
    });

    it('honors explicit from/to and does NOT apply the default', () => {
      const now = Date.UTC(2026, 6, 11);
      expect(computeScheduledWindow('100', '200', now)).toEqual({ from: 100, to: 200 });
    });

    it('allows an open upper bound when only from is passed', () => {
      const now = Date.UTC(2026, 6, 11);
      expect(computeScheduledWindow('100', undefined, now)).toEqual({ from: 100, to: null });
    });
  });

  describe('computeReviewWindow (req 3)', () => {
    it('is all-time (null/null) when both bounds absent', () => {
      expect(computeReviewWindow(undefined, undefined)).toEqual({ from: null, to: null });
    });

    it('honors explicit bounds when passed', () => {
      expect(computeReviewWindow('100', '200')).toEqual({ from: 100, to: 200 });
    });
  });

  describe('windowMatch', () => {
    it('produces an empty match for an all-time window', () => {
      expect(windowMatch('scheduledAt', { from: null, to: null })).toEqual({});
    });

    it('produces a $gte/$lte range for a bounded window', () => {
      expect(windowMatch('scheduledAt', { from: 100, to: 200 })).toEqual({ scheduledAt: { $gte: 100, $lte: 200 } });
    });
  });

  describe('windowMatchDate (req 6 — Billing.createdAt is a Date, not epoch-ms)', () => {
    it('produces an empty match for an all-time window', () => {
      expect(windowMatchDate('createdAt', { from: null, to: null })).toEqual({});
    });

    it('wraps bounds as actual Date instances, not raw numbers', () => {
      const match = windowMatchDate('createdAt', { from: 100, to: 200 });
      expect(match.createdAt.$gte).toBeInstanceOf(Date);
      expect(match.createdAt.$lte).toBeInstanceOf(Date);
      expect(match.createdAt.$gte.getTime()).toBe(100);
      expect(match.createdAt.$lte.getTime()).toBe(200);
    });

    it('supports an open bound (only from, or only to)', () => {
      const onlyFrom = windowMatchDate('createdAt', { from: 100, to: null });
      expect(onlyFrom.createdAt.$gte).toBeInstanceOf(Date);
      expect(onlyFrom.createdAt.$lte).toBeUndefined();
    });
  });

  describe('clampLimit', () => {
    it('defaults to 5 for missing/invalid input', () => {
      expect(clampLimit(undefined)).toBe(5);
      expect(clampLimit('abc')).toBe(5);
    });
    it('clamps to [1, 50]', () => {
      expect(clampLimit('10')).toBe(10);
      expect(clampLimit(0)).toBe(1);
      expect(clampLimit(999)).toBe(50);
    });
  });

  describe('mapFrequentPatientRow (req 4 null-safe)', () => {
    it('maps a fully resolved patient to name + status + accountId + examCount', () => {
      const row = {
        examCount: 8,
        patient: { _id: 'p1', accountId: 'a1' },
        profile: { name: 'Nguyễn B' },
        account: { _id: 'a1', status: 'ACTIVE' },
      };
      expect(mapFrequentPatientRow(row)).toEqual({
        accountId: 'a1',
        name: 'Nguyễn B',
        status: 'ACTIVE',
        examCount: 8,
      });
    });

    it('is null-safe when the patientId does not resolve (landmine): nulls, count preserved', () => {
      const row = { examCount: 3, patient: null, profile: null, account: null };
      expect(mapFrequentPatientRow(row)).toEqual({
        accountId: null,
        name: null,
        status: null,
        examCount: 3,
      });
    });
  });
});
