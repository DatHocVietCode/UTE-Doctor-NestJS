import { ActorSummary } from '../dto/actor-summary.dto';
import { LifecycleEdge, LifecycleNode } from '../dto/lifecycle-tree.dto';
import { LifecycleWarning } from '../dto/lifecycle-warning.dto';
import { ActorConfidence, ActorSource, ActorType, TimestampConfidence } from '../enums/actor.enums';
import { EdgeStatus } from '../enums/edge-status.enum';
import { LifecyclePhase } from '../enums/lifecycle-phase.enum';
import { NodeStatus } from '../enums/node-status.enum';
import { WarningCode, WarningScope, WarningSeverity } from '../enums/warning.enums';

// Shared node/edge/warning construction helpers used by both the phase builders
// and the conflict pass. Kept separate to avoid a circular import.

export function fallbackActor(): ActorSummary {
  return {
    actorType: ActorType.UNKNOWN,
    actorConfidence: ActorConfidence.UNKNOWN,
    actorSource: ActorSource.FALLBACK,
  };
}

export function nodeId(phase: LifecyclePhase, collection: string, recordId: string, key: string): string {
  return `${phase}:${collection}:${recordId}:${key}`;
}

export function mkNode(
  partial: Partial<LifecycleNode> &
    Pick<LifecycleNode, 'id' | 'phase' | 'eventType' | 'label' | 'sourceCollection'>,
): LifecycleNode {
  const ts = partial.timestamp ?? null;
  return {
    labelKey: undefined,
    timestamp: ts,
    timestampConfidence: ts != null ? TimestampConfidence.EXACT : TimestampConfidence.MISSING,
    nodeStatus: NodeStatus.OK,
    actor: fallbackActor(),
    sourceRecordId: null,
    parentId: '',
    summary: {},
    warnings: [],
    hasDetail: true,
    ...partial,
  };
}

export function edge(from: string, to: string, edgeStatus: EdgeStatus): LifecycleEdge {
  return { from, to, edgeStatus };
}

export function warn(
  code: WarningCode,
  message: string,
  severity: WarningSeverity = WarningSeverity.WARN,
  scope: WarningScope = WarningScope.NODE,
  relatedNodeId?: string,
): LifecycleWarning {
  return { code, message, severity, scope, relatedNodeId };
}
