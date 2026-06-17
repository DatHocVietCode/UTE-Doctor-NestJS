import { ActorSummary } from './actor-summary.dto';
import { LifecycleWarning } from './lifecycle-warning.dto';

export interface LifecycleNodeDetail {
  nodeId: string;
  eventType: string;
  phase: string;
  timestamp: number | null;
  statusBefore?: string;
  statusAfter?: string;
  actor: ActorSummary;
  // Sanitized domain snapshot (sensitive patient fields masked/omitted by default).
  // Raw payloads are intentionally NOT included (deferred debug-only hardening).
  domainSnapshot: Record<string, unknown>;
  sourceMeta: {
    collection: string;
    recordId: string | null;
  };
  warnings: LifecycleWarning[];
  // false when the node could only be partially reconstructed.
  complete: boolean;
}
