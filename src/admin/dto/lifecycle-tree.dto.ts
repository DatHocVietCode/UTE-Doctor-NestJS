import { EdgeStatus } from '../enums/edge-status.enum';
import { LifecycleEventType } from '../enums/lifecycle-event-type.enum';
import { LifecyclePhase } from '../enums/lifecycle-phase.enum';
import { NodeStatus } from '../enums/node-status.enum';
import { TimestampConfidence } from '../enums/actor.enums';
import { ActorSummary } from './actor-summary.dto';
import { LifecycleWarning } from './lifecycle-warning.dto';

export interface LifecycleNode {
  id: string;
  phase: LifecyclePhase;
  eventType: LifecycleEventType | string;
  label: string;
  labelKey?: string;
  timestamp: number | null;
  timestampConfidence: TimestampConfidence;
  statusBefore?: string;
  statusAfter?: string;
  nodeStatus: NodeStatus;
  actor: ActorSummary;
  sourceCollection: string;
  sourceRecordId: string | null;
  parentId: string;
  // Safe, summarized display fields only. No raw payloads / PII here.
  summary: Record<string, unknown>;
  warnings: LifecycleWarning[];
  hasDetail: boolean;
}

export interface LifecycleEdge {
  from: string;
  to: string;
  edgeStatus: EdgeStatus;
  warnings?: LifecycleWarning[];
}

export interface LifecyclePhaseSummary {
  phase: LifecyclePhase;
  status: NodeStatus;
  nodeCount: number;
}

export interface LifecycleTreeReconstructionMeta {
  strategy: 'DOMAIN_FIRST';
  generatedAt: number;
  partial: boolean;
}

export interface LifecycleAppointmentSummary {
  id: string;
  appointmentStatus?: string;
  assignmentStatus?: string;
  paymentCategory?: string;
  depositStatus?: string;
  scheduledAt?: number | null;
  bookingDate?: number | null;
}

export interface LifecycleTree {
  appointment: LifecycleAppointmentSummary;
  rootNodeId: string;
  nodes: LifecycleNode[];
  edges: LifecycleEdge[];
  phases: LifecyclePhaseSummary[];
  globalWarnings: LifecycleWarning[];
  reconstruction: LifecycleTreeReconstructionMeta;
}
