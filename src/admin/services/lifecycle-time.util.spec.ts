import { LifecyclePhase } from '../enums/lifecycle-phase.enum';
import { normalizeTimestamp, sortNodesStable } from './lifecycle-time.util';

describe('normalizeTimestamp', () => {
  it('passes through finite epoch numbers', () => {
    expect(normalizeTimestamp(1000)).toBe(1000);
  });
  it('converts Date to epoch ms', () => {
    expect(normalizeTimestamp(new Date(1234))).toBe(1234);
  });
  it('parses ISO strings', () => {
    expect(normalizeTimestamp('2021-01-01T00:00:00.000Z')).toBe(Date.UTC(2021, 0, 1));
  });
  it('returns null for null/undefined/NaN/invalid/object', () => {
    expect(normalizeTimestamp(null)).toBeNull();
    expect(normalizeTimestamp(undefined)).toBeNull();
    expect(normalizeTimestamp(NaN)).toBeNull();
    expect(normalizeTimestamp('not-a-date')).toBeNull();
    expect(normalizeTimestamp({})).toBeNull();
  });
});

describe('sortNodesStable', () => {
  const n = (phase: LifecyclePhase, timestamp: number | null, sourceRecordId: string | null) =>
    ({ phase, timestamp, sourceRecordId } as any);

  it('orders by phase, then timestamp, with missing timestamps sinking to the end of their phase', () => {
    const input = [
      n(LifecyclePhase.VISIT, 50, 'v'),
      n(LifecyclePhase.BOOKING, null, 'b-null'),
      n(LifecyclePhase.BOOKING, 10, 'b10'),
      n(LifecyclePhase.DEPOSIT, 20, 'd'),
    ];
    const out = sortNodesStable(input).map((x) => x.sourceRecordId);
    expect(out).toEqual(['b10', 'b-null', 'd', 'v']);
  });

  it('is deterministic via the sourceRecordId tiebreak when phase+timestamp are equal', () => {
    const input = [
      n(LifecyclePhase.BOOKING, 10, 'b'),
      n(LifecyclePhase.BOOKING, 10, 'a'),
    ];
    expect(sortNodesStable(input).map((x) => x.sourceRecordId)).toEqual(['a', 'b']);
  });

  it('does not throw when all timestamps are missing', () => {
    const input = [n(LifecyclePhase.BOOKING, null, 'b'), n(LifecyclePhase.BOOKING, null, 'a')];
    expect(() => sortNodesStable(input)).not.toThrow();
    expect(sortNodesStable(input).map((x) => x.sourceRecordId)).toEqual(['a', 'b']);
  });
});
