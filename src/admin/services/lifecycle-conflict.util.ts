import { LifecycleBundle } from '../dto/lifecycle-bundle';
import { LifecycleEdge, LifecycleNode } from '../dto/lifecycle-tree.dto';
import { LifecycleWarning } from '../dto/lifecycle-warning.dto';
import { TimestampConfidence } from '../enums/actor.enums';
import { EdgeStatus } from '../enums/edge-status.enum';
import { LifecycleEventType } from '../enums/lifecycle-event-type.enum';
import { LifecyclePhase } from '../enums/lifecycle-phase.enum';
import { NodeStatus } from '../enums/node-status.enum';
import { WarningCode, WarningScope, WarningSeverity } from '../enums/warning.enums';
import { edge, mkNode, nodeId, warn } from './lifecycle-node.util';

export interface ConflictResult {
  globalWarnings: LifecycleWarning[];
  extraNodes: LifecycleNode[];
  extraEdges: LifecycleEdge[];
}

const ACTIVE_TASK_STATUSES = ['PENDING', 'ASSIGNED'];

// Conservative conflict detection. Conflicts are surfaced as warnings + CONFLICT/PARTIAL
// node flags; they NEVER abort reconstruction. Mutates matched nodes' status/warnings
// in place and returns any synthetic placeholder nodes/edges.
export function applyConflicts(
  bundle: LifecycleBundle,
  nodes: LifecycleNode[],
  rootNodeId: string,
): ConflictResult {
  const appt = bundle.appointment ?? {};
  const apptId = String(appt._id);
  const globalWarnings: LifecycleWarning[] = [];
  const extraNodes: LifecycleNode[] = [];
  const extraEdges: LifecycleEdge[] = [];

  // 1) More than one active assignment task for one appointment.
  const activeTasks = (bundle.assignmentTasks ?? []).filter((t) =>
    ACTIVE_TASK_STATUSES.includes(t?.status),
  );
  if (activeTasks.length > 1) {
    globalWarnings.push(
      warn(
        WarningCode.CONFLICT_MULTIPLE_ACTIVE_TASKS,
        `Found ${activeTasks.length} active assignment tasks for one appointment.`,
        WarningSeverity.ERROR,
        WarningScope.TREE,
      ),
    );
    for (const n of nodes) {
      if (n.phase === LifecyclePhase.ASSIGNMENT) {
        n.nodeStatus = NodeStatus.CONFLICT;
        n.warnings.push(
          warn(
            WarningCode.CONFLICT_MULTIPLE_ACTIVE_TASKS,
            'Multiple active assignment tasks exist for this appointment.',
            WarningSeverity.ERROR,
            WarningScope.NODE,
            n.id,
          ),
        );
      }
    }
  }

  // 2) Appointment COMPLETED with no Visit.
  if (appt.appointmentStatus === 'COMPLETED' && !bundle.visit) {
    globalWarnings.push(
      warn(
        WarningCode.CONFLICT_COMPLETED_WITHOUT_VISIT,
        'Appointment is COMPLETED but no Visit record exists.',
        WarningSeverity.ERROR,
        WarningScope.TREE,
      ),
    );
    const id = nodeId(LifecyclePhase.VISIT, 'visits', apptId, 'missing');
    extraNodes.push(
      mkNode({
        id,
        phase: LifecyclePhase.VISIT,
        eventType: LifecycleEventType.VISIT_CREATED,
        label: 'Visit expected but missing',
        timestamp: null,
        timestampConfidence: TimestampConfidence.MISSING,
        nodeStatus: NodeStatus.CONFLICT,
        sourceCollection: 'visits',
        sourceRecordId: null,
        parentId: rootNodeId,
        hasDetail: false,
        warnings: [
          warn(
            WarningCode.CONFLICT_COMPLETED_WITHOUT_VISIT,
            'Appointment is COMPLETED but no Visit was found.',
            WarningSeverity.ERROR,
            WarningScope.NODE,
            id,
          ),
        ],
      }),
    );
    extraEdges.push(edge(rootNodeId, id, EdgeStatus.MISSING));
  }

  // 3) Billing PAID while appointment is not COMPLETED.
  if (bundle.billing?.status === 'PAID' && appt.appointmentStatus !== 'COMPLETED') {
    globalWarnings.push(
      warn(
        WarningCode.CONFLICT_BILLING_PAID_APPOINTMENT_NOT_COMPLETED,
        'Billing is PAID but the appointment is not COMPLETED.',
        WarningSeverity.WARN,
        WarningScope.TREE,
      ),
    );
    for (const n of nodes) {
      if (n.eventType === LifecycleEventType.BILLING_PAID) {
        n.nodeStatus = NodeStatus.CONFLICT;
        n.warnings.push(
          warn(
            WarningCode.CONFLICT_BILLING_PAID_APPOINTMENT_NOT_COMPLETED,
            'Billing PAID but appointment is not COMPLETED.',
            WarningSeverity.WARN,
            WarningScope.NODE,
            n.id,
          ),
        );
      }
    }
  }

  // 4) depositStatus PAID but no deposit Payment row (e.g. TTL-deleted).
  if (appt.depositStatus === 'PAID' && (bundle.depositPayments ?? []).length === 0) {
    globalWarnings.push(
      warn(
        WarningCode.CONFLICT_DEPOSIT_PAID_WITHOUT_PAYMENT,
        'Deposit is marked PAID but no deposit Payment record was found.',
        WarningSeverity.WARN,
        WarningScope.TREE,
      ),
    );
    for (const n of nodes) {
      if (n.eventType === LifecycleEventType.DEPOSIT_PAID) {
        n.nodeStatus = NodeStatus.PARTIAL;
        n.warnings.push(
          warn(
            WarningCode.PAYMENT_RECORD_EXPIRED,
            'Deposit Payment record not found (may have been TTL-expired).',
            WarningSeverity.WARN,
            WarningScope.NODE,
            n.id,
          ),
        );
      }
    }
  }

  return { globalWarnings, extraNodes, extraEdges };
}
