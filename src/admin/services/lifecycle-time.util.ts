import { LifecycleNode } from '../dto/lifecycle-tree.dto';
import { PHASE_ORDER, LifecyclePhase } from '../enums/lifecycle-phase.enum';

// Normalize a stored time value (epoch number | Date | string | undefined/null) to
// epoch milliseconds, or null when it cannot be interpreted. Never throws.
export function normalizeTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'string') {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? null : t;
  }
  // Mongoose ObjectId or other object: ignore for timestamps.
  return null;
}

// Stable, defensive comparator for lifecycle nodes:
//   1. phase order (canonical causal order)
//   2. timestamp ascending; missing timestamps sink to the end of their phase
//   3. source createdAt (secondary derived ordering)
//   4. source record id (final tiebreak for determinism)
// Never throws on null/undefined.
export function compareNodes(
  a: Pick<LifecycleNode, 'phase' | 'timestamp' | 'sourceRecordId'>,
  b: Pick<LifecycleNode, 'phase' | 'timestamp' | 'sourceRecordId'>,
  secondary?: (n: any) => number | null,
): number {
  const pa = PHASE_ORDER[a.phase as LifecyclePhase] ?? Number.MAX_SAFE_INTEGER;
  const pb = PHASE_ORDER[b.phase as LifecyclePhase] ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;

  const ta = a.timestamp ?? Number.POSITIVE_INFINITY;
  const tb = b.timestamp ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;

  if (secondary) {
    const sa = secondary(a) ?? Number.POSITIVE_INFINITY;
    const sb = secondary(b) ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
  }

  const ia = a.sourceRecordId ?? '';
  const ib = b.sourceRecordId ?? '';
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return 0;
}

export function sortNodesStable(nodes: LifecycleNode[]): LifecycleNode[] {
  return [...nodes].sort((a, b) => compareNodes(a, b));
}
