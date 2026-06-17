import { LifecycleBundle } from '../dto/lifecycle-bundle';
import {
  LifecycleEdge,
  LifecycleNode,
  LifecyclePhaseSummary,
  LifecycleTree,
} from '../dto/lifecycle-tree.dto';
import { LifecycleWarning } from '../dto/lifecycle-warning.dto';
import { TimestampConfidence } from '../enums/actor.enums';
import { EdgeStatus } from '../enums/edge-status.enum';
import { LifecycleEventType } from '../enums/lifecycle-event-type.enum';
import { LifecyclePhase, PHASE_ORDER } from '../enums/lifecycle-phase.enum';
import { NodeStatus } from '../enums/node-status.enum';
import { WarningCode, WarningScope, WarningSeverity } from '../enums/warning.enums';
import {
  actorFromHistoryBy,
  actorFromRelation,
  actorFromStoredField,
  roleInferredActor,
  systemActor,
} from './actor-resolver.service';
import { applyConflicts } from './lifecycle-conflict.util';
import { edge, mkNode, nodeId, warn } from './lifecycle-node.util';
import { normalizeTimestamp, sortNodesStable } from './lifecycle-time.util';

interface BuiltBranch {
  nodes: LifecycleNode[];
  edges: LifecycleEdge[];
  warnings?: LifecycleWarning[];
}

// ── BOOKING ────────────────────────────────────────────────────────────────
function buildBookingPhase(bundle: LifecycleBundle): { rootNodeId: string; nodes: LifecycleNode[] } {
  const appt = bundle.appointment;
  const apptId = String(appt._id);
  const ts = normalizeTimestamp(appt.createdAt ?? appt.bookingDate);
  const id = nodeId(LifecyclePhase.BOOKING, 'appointments', apptId, 'created');

  return {
    rootNodeId: id,
    nodes: [
      mkNode({
        id,
        phase: LifecyclePhase.BOOKING,
        eventType: LifecycleEventType.APPOINTMENT_CREATED,
        label: 'Appointment created',
        labelKey: 'lifecycle.booking.created',
        timestamp: ts,
        statusAfter: 'PENDING',
        sourceCollection: 'appointments',
        sourceRecordId: apptId,
        parentId: '',
        summary: {
          paymentCategory: appt.paymentCategory,
          serviceType: appt.serviceType,
          reasonForAppointment: appt.reasonForAppointment,
        },
      }),
    ],
  };
}

// ── DEPOSIT ──────────────────────────────────────────────────────────────--
// Deposit edges are STRONG (Payment.appointmentId + Appointment.depositPaymentId).
// Note: pending/expired Payment rows can be TTL-deleted, so a PAID deposit with no
// Payment row is handled defensively (PARTIAL) by the conflict pass.
function buildDepositPhase(bundle: LifecycleBundle, rootNodeId: string): BuiltBranch {
  const appt = bundle.appointment;
  const apptId = String(appt._id);
  const status = appt.depositStatus;
  const nodes: LifecycleNode[] = [];
  const edges: LifecycleEdge[] = [];

  if (!status || status === 'NOT_REQUIRED') {
    return { nodes, edges };
  }

  const depositPayment = (bundle.depositPayments ?? [])[0];
  const edgeStatus = EdgeStatus.STRONG_LINK;

  const add = (key: string, eventType: LifecycleEventType, label: string, node: Partial<LifecycleNode>) => {
    const id = nodeId(LifecyclePhase.DEPOSIT, node.sourceCollection ?? 'appointments', node.sourceRecordId ?? apptId, key);
    nodes.push(
      mkNode({
        id,
        phase: LifecyclePhase.DEPOSIT,
        eventType,
        label,
        parentId: rootNodeId,
        ...node,
      } as any),
    );
    edges.push(edge(rootNodeId, id, edgeStatus));
  };

  if (depositPayment) {
    add('initiated', LifecycleEventType.DEPOSIT_INITIATED, 'Deposit initiated', {
      timestamp: normalizeTimestamp(depositPayment.createdAt),
      statusAfter: 'PENDING',
      actor: systemActor(),
      sourceCollection: 'payments',
      sourceRecordId: String(depositPayment._id),
      summary: { amount: depositPayment.amount },
    });
  }

  if (status === 'PAID') {
    add('paid', LifecycleEventType.DEPOSIT_PAID, 'Deposit paid', {
      labelKey: 'lifecycle.deposit.paid',
      timestamp: normalizeTimestamp(appt.depositPaidAt ?? depositPayment?.paidAt),
      statusAfter: 'PAID',
      actor: systemActor(),
      sourceCollection: depositPayment ? 'payments' : 'appointments',
      sourceRecordId: depositPayment ? String(depositPayment._id) : apptId,
      summary: { amount: appt.depositPaidAmount ?? depositPayment?.amount },
    });
  }

  if (status === 'FAILED') {
    add('failed', LifecycleEventType.DEPOSIT_FAILED, 'Deposit failed', {
      timestamp: normalizeTimestamp(depositPayment?.updatedAt ?? appt.updatedAt),
      timestampConfidence: TimestampConfidence.INFERRED,
      statusAfter: 'FAILED',
      nodeStatus: NodeStatus.PARTIAL,
      actor: systemActor(),
    });
  }

  if (status === 'REFUNDED' || status === 'FORFEITED') {
    const refundTxn = (bundle.creditTransactions ?? []).find((t) => t?.type === 'credit');
    const isForfeit = status === 'FORFEITED';
    add(isForfeit ? 'forfeited' : 'refunded', isForfeit ? LifecycleEventType.DEPOSIT_FORFEITED : LifecycleEventType.DEPOSIT_REFUNDED, isForfeit ? 'Deposit forfeited' : 'Deposit refunded', {
      timestamp: normalizeTimestamp(refundTxn?.createdAt ?? appt.cancelledAt ?? appt.updatedAt),
      timestampConfidence: refundTxn ? TimestampConfidence.EXACT : TimestampConfidence.INFERRED,
      statusAfter: status,
      actor: systemActor(),
      sourceCollection: refundTxn ? 'credittransactions' : 'appointments',
      sourceRecordId: refundTxn ? String(refundTxn._id) : apptId,
      summary: { amount: refundTxn?.amount },
    });
  }

  return { nodes, edges };
}

// ── ASSIGNMENT ──────────────────────────────────────────────────────────---
// Broad bookings route through an AppointmentAssignmentTask whose `history[]` is the
// only true append-only transition log in the system (actor available via `by`).
function buildAssignmentPhase(bundle: LifecycleBundle, rootNodeId: string): BuiltBranch {
  const nodes: LifecycleNode[] = [];
  const edges: LifecycleEdge[] = [];

  for (const task of bundle.assignmentTasks ?? []) {
    const taskId = String(task._id);
    const history: any[] = Array.isArray(task.history) ? task.history : [];

    if (history.length === 0) {
      // Legacy / minimal task: synthesize a single creation node from createdAt.
      const ts = normalizeTimestamp(task.createdAt);
      const id = nodeId(LifecyclePhase.ASSIGNMENT, 'appointmentassignmenttasks', taskId, 'created');
      nodes.push(
        mkNode({
          id,
          phase: LifecyclePhase.ASSIGNMENT,
          eventType: LifecycleEventType.ASSIGNMENT_TASK_CREATED,
          label: 'Assignment task created',
          timestamp: ts,
          statusAfter: task.status,
          sourceCollection: 'appointmentassignmenttasks',
          sourceRecordId: taskId,
          parentId: rootNodeId,
          summary: { status: task.status, specialty: task.specialty },
        }),
      );
      edges.push(edge(rootNodeId, id, EdgeStatus.STRONG_LINK));
      continue;
    }

    history.forEach((entry, i) => {
      const ts = normalizeTimestamp(entry?.at);
      const id = nodeId(LifecyclePhase.ASSIGNMENT, 'appointmentassignmenttasks', taskId, `h${i}`);
      const isCreate = i === 0 || entry?.from === 'NONE';
      nodes.push(
        mkNode({
          id,
          phase: LifecyclePhase.ASSIGNMENT,
          eventType: isCreate
            ? LifecycleEventType.ASSIGNMENT_TASK_CREATED
            : LifecycleEventType.ASSIGNMENT_TASK_TRANSITION,
          label: isCreate ? 'Assignment task created' : `Assignment ${entry?.from} → ${entry?.to}`,
          timestamp: ts,
          statusBefore: entry?.from,
          statusAfter: entry?.to,
          actor: actorFromHistoryBy(entry?.by, bundle.lookups),
          sourceCollection: 'appointmentassignmenttasks',
          sourceRecordId: taskId,
          parentId: rootNodeId,
          summary: { note: entry?.note, specialty: task.specialty },
        }),
      );
      edges.push(edge(rootNodeId, id, EdgeStatus.STRONG_LINK));
    });
  }

  return { nodes, edges };
}

// ── CONFIRMATION ────────────────────────────────────────────────────────---
// Confirmation has no dedicated record; its time is inferred from the trigger
// (deposit paid / assignment completed / immediate for BHYT).
function buildConfirmationPhase(bundle: LifecycleBundle, rootNodeId: string): BuiltBranch {
  const appt = bundle.appointment;
  const status = appt.appointmentStatus;
  if (status !== 'CONFIRMED' && status !== 'COMPLETED') {
    return { nodes: [], edges: [] };
  }

  const apptId = String(appt._id);
  let ts =
    normalizeTimestamp(appt.depositPaidAt) ??
    normalizeTimestamp((bundle.assignmentTasks ?? [])[0]?.completedAt) ??
    normalizeTimestamp(appt.createdAt);

  const id = nodeId(LifecyclePhase.CONFIRMATION, 'appointments', apptId, 'confirmed');
  const node = mkNode({
    id,
    phase: LifecyclePhase.CONFIRMATION,
    eventType: LifecycleEventType.APPOINTMENT_CONFIRMED,
    label: 'Appointment confirmed',
    timestamp: ts,
    timestampConfidence: ts != null ? TimestampConfidence.INFERRED : TimestampConfidence.MISSING,
    statusAfter: 'CONFIRMED',
    sourceCollection: 'appointments',
    sourceRecordId: apptId,
    parentId: rootNodeId,
  });
  return { nodes: [node], edges: [edge(rootNodeId, id, EdgeStatus.INFERRED)] };
}

// ── VISIT ───────────────────────────────────────────────────────────────---
const VISIT_RANK: Record<string, number> = {
  CREATED: 0,
  CHECKED_IN: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
};

function buildVisitPhase(bundle: LifecycleBundle, rootNodeId: string): BuiltBranch {
  const visit = bundle.visit;
  if (!visit) return { nodes: [], edges: [] };

  const visitId = String(visit._id);
  const nodes: LifecycleNode[] = [];
  const edges: LifecycleEdge[] = [];
  const status = visit.status;
  const rank = VISIT_RANK[status] ?? 0;

  const push = (key: string, eventType: LifecycleEventType, label: string, node: Partial<LifecycleNode>) => {
    const id = nodeId(LifecyclePhase.VISIT, 'visits', visitId, key);
    nodes.push(
      mkNode({
        id,
        phase: LifecyclePhase.VISIT,
        eventType,
        label,
        sourceCollection: 'visits',
        sourceRecordId: visitId,
        parentId: rootNodeId,
        ...node,
      }),
    );
    edges.push(edge(rootNodeId, id, EdgeStatus.STRONG_LINK));
  };

  push('created', LifecycleEventType.VISIT_CREATED, 'Visit created', {
    timestamp: normalizeTimestamp(visit.createdAt),
    statusAfter: 'CREATED',
    actor: systemActor(),
  });

  if (status === 'CANCELLED') {
    push('cancelled', LifecycleEventType.VISIT_CANCELLED, 'Visit cancelled', {
      timestamp: normalizeTimestamp(visit.updatedAt),
      statusAfter: 'CANCELLED',
      nodeStatus: NodeStatus.PARTIAL,
    });
    return { nodes, edges };
  }

  if (rank >= VISIT_RANK.CHECKED_IN) {
    const id = nodeId(LifecyclePhase.VISIT, 'visits', visitId, 'checked_in');
    // No checkedInAt field exists on the Visit schema; time cannot be recovered.
    push('checked_in', LifecycleEventType.VISIT_CHECKED_IN, 'Patient checked in', {
      timestamp: null,
      timestampConfidence: TimestampConfidence.MISSING,
      statusAfter: 'CHECKED_IN',
      nodeStatus: NodeStatus.PARTIAL,
      actor: roleInferredActor('RECEPTIONIST'),
      warnings: [
        warn(
          WarningCode.NO_CHECKIN_TIMESTAMP,
          'Visit check-in time is not stored; ordering is approximate.',
          WarningSeverity.INFO,
          WarningScope.NODE,
          id,
        ),
      ],
    });
  }

  if (rank >= VISIT_RANK.IN_PROGRESS) {
    const startTs = normalizeTimestamp(visit.startedAt);
    push('started', LifecycleEventType.VISIT_STARTED, 'Visit started', {
      timestamp: startTs,
      statusAfter: 'IN_PROGRESS',
      actor: actorFromRelation(visit.doctorId, 'DOCTOR', bundle.lookups, bundle.lookups?.doctors),
    });
  }

  if (rank >= VISIT_RANK.COMPLETED) {
    push('completed', LifecycleEventType.VISIT_COMPLETED, 'Visit completed', {
      timestamp: normalizeTimestamp(visit.completedAt),
      statusAfter: 'COMPLETED',
      actor: actorFromRelation(visit.doctorId, 'DOCTOR', bundle.lookups, bundle.lookups?.doctors),
    });
  }

  return { nodes, edges };
}

// ── ENCOUNTER ──────────────────────────────────────────────────────────---
function buildEncounterPhase(bundle: LifecycleBundle, rootNodeId: string): BuiltBranch {
  const enc = bundle.encounter;
  if (!enc) return { nodes: [], edges: [] };

  const encId = String(enc._id);
  const ts = normalizeTimestamp(enc.dateRecord ?? enc.createdAt);
  const id = nodeId(LifecyclePhase.ENCOUNTER, 'medicalencounters', encId, 'created');
  const node = mkNode({
    id,
    phase: LifecyclePhase.ENCOUNTER,
    eventType: LifecycleEventType.ENCOUNTER_CREATED,
    label: 'Medical encounter recorded',
    timestamp: ts,
    statusAfter: 'RECORDED',
    actor: actorFromStoredField(
      enc.createdByAccountId ?? enc.createdByDoctorId,
      enc.createdByRole ?? 'DOCTOR',
      bundle.lookups,
    ),
    sourceCollection: 'medicalencounters',
    sourceRecordId: encId,
    parentId: rootNodeId,
    summary: {
      hasDiagnosis: Boolean(enc.diagnosis),
      prescriptionCount: Array.isArray(enc.prescriptions) ? enc.prescriptions.length : 0,
    },
  });
  return { nodes: [node], edges: [edge(rootNodeId, id, EdgeStatus.STRONG_LINK)] };
}

// ── BILLING ─────────────────────────────────────────────────────────────---
// Billing has no appointmentId (only visitId), so the link is WEAK unless a
// denormalized appointmentId is present. A completed visit with no billing yields
// a MISSING placeholder rather than a silent gap.
function buildBillingPhase(bundle: LifecycleBundle, rootNodeId: string): BuiltBranch {
  const billing = bundle.billing;
  const apptId = String(bundle.appointment._id);
  const completed =
    bundle.appointment.appointmentStatus === 'COMPLETED' || bundle.visit?.status === 'COMPLETED';

  if (!billing) {
    if (!completed) return { nodes: [], edges: [] };
    const id = nodeId(LifecyclePhase.BILLING, 'billings', apptId, 'missing');
    const node = mkNode({
      id,
      phase: LifecyclePhase.BILLING,
      eventType: LifecycleEventType.BILLING_CREATED,
      label: 'Billing not found',
      timestamp: null,
      timestampConfidence: TimestampConfidence.MISSING,
      nodeStatus: NodeStatus.MISSING,
      sourceCollection: 'billings',
      sourceRecordId: null,
      parentId: rootNodeId,
      hasDetail: false,
      warnings: [
        warn(
          WarningCode.MISSING_BILLING,
          'Visit is completed but no billing record was found.',
          WarningSeverity.WARN,
          WarningScope.NODE,
          id,
        ),
      ],
    });
    return { nodes: [node], edges: [edge(rootNodeId, id, EdgeStatus.MISSING)] };
  }

  const billId = String(billing._id);
  const hasApptFk = Boolean(billing.appointmentId);
  const edgeStatus = hasApptFk ? EdgeStatus.STRONG_LINK : EdgeStatus.WEAK_LINK;
  const linkWarnings = hasApptFk
    ? []
    : [
        warn(
          WarningCode.WEAK_BILLING_LINK,
          'Billing links to the appointment only via Visit (no appointmentId).',
          WarningSeverity.INFO,
        ),
      ];
  const bp = (bundle.billingPayments ?? [])[0];
  const nodes: LifecycleNode[] = [];
  const edges: LifecycleEdge[] = [];

  const add = (key: string, eventType: LifecycleEventType, label: string, node: Partial<LifecycleNode>) => {
    const id = nodeId(LifecyclePhase.BILLING, 'billings', billId, key);
    nodes.push(
      mkNode({
        id,
        phase: LifecyclePhase.BILLING,
        eventType,
        label,
        sourceCollection: 'billings',
        sourceRecordId: billId,
        parentId: rootNodeId,
        warnings: [...linkWarnings],
        ...node,
      }),
    );
    edges.push(edge(rootNodeId, id, edgeStatus));
  };

  add('created', LifecycleEventType.BILLING_CREATED, 'Billing draft created', {
    timestamp: normalizeTimestamp(billing.createdAt),
    statusAfter: 'DRAFT',
    summary: { finalPayable: billing.finalPayable, totalAmount: billing.totalAmount },
  });

  if (billing.status === 'FINALIZED' || billing.status === 'PAID') {
    const ts = normalizeTimestamp(bp?.createdAt ?? billing.updatedAt);
    add('finalized', LifecycleEventType.BILLING_FINALIZED, 'Billing finalized', {
      timestamp: ts,
      timestampConfidence: ts != null ? TimestampConfidence.INFERRED : TimestampConfidence.MISSING,
      statusAfter: 'FINALIZED',
      actor: roleInferredActor('RECEPTIONIST'),
    });
  }

  if (billing.status === 'PAID') {
    const ts = normalizeTimestamp(bp?.paidAt ?? billing.updatedAt);
    add('paid', LifecycleEventType.BILLING_PAID, 'Billing paid', {
      timestamp: ts,
      timestampConfidence: ts != null ? TimestampConfidence.INFERRED : TimestampConfidence.MISSING,
      statusAfter: 'PAID',
    });
  }

  return { nodes, edges };
}

// ── PAYMENT (billing) ───────────────────────────────────────────────────---
// Billing payments link to the appointment only through Billing -> Visit (2 hops): WEAK.
function buildPaymentPhase(bundle: LifecycleBundle, rootNodeId: string): BuiltBranch {
  const nodes: LifecycleNode[] = [];
  const edges: LifecycleEdge[] = [];

  for (const bp of bundle.billingPayments ?? []) {
    const bpId = String(bp._id);
    const add = (key: string, eventType: LifecycleEventType, label: string, node: Partial<LifecycleNode>) => {
      const id = nodeId(LifecyclePhase.PAYMENT, 'payments', bpId, key);
      nodes.push(
        mkNode({
          id,
          phase: LifecyclePhase.PAYMENT,
          eventType,
          label,
          sourceCollection: 'payments',
          sourceRecordId: bpId,
          parentId: rootNodeId,
          ...node,
        }),
      );
      edges.push(edge(rootNodeId, id, EdgeStatus.WEAK_LINK));
    };

    add('created', LifecycleEventType.PAYMENT_CREATED, 'Payment created', {
      timestamp: normalizeTimestamp(bp.createdAt),
      statusAfter: 'PENDING',
      summary: { amount: bp.amount, method: bp.method },
    });

    if (bp.status === 'SUCCESS') {
      // Cash mark-paid is a receptionist action; QR/VNPAY is a system callback.
      const actor = bp.method === 'CASH' ? roleInferredActor('RECEPTIONIST') : systemActor();
      add('success', LifecycleEventType.PAYMENT_SUCCESS, 'Payment succeeded', {
        timestamp: normalizeTimestamp(bp.paidAt ?? bp.createdAt),
        statusAfter: 'SUCCESS',
        actor,
        summary: { amount: bp.amount, method: bp.method },
      });
    }

    if (bp.refundedAt) {
      add('refunded', LifecycleEventType.PAYMENT_REFUNDED, 'Payment refunded', {
        timestamp: normalizeTimestamp(bp.refundedAt),
        statusAfter: 'REFUNDED',
      });
    }
  }

  return { nodes, edges };
}

// ── SLOT (inferred) ─────────────────────────────────────────────────────---
// TimeSlotLog stores only a current status with no appointment backref, so slot
// events are INFERRED from the appointment/visit side and always carry a warning.
function buildSlotPhase(bundle: LifecycleBundle, rootNodeId: string): BuiltBranch {
  const appt = bundle.appointment;
  const slot = bundle.timeSlot;
  if (!slot && !appt.timeSlot) return { nodes: [], edges: [] };

  const slotId = slot ? String(slot._id) : String(appt.timeSlot);
  const nodes: LifecycleNode[] = [];
  const edges: LifecycleEdge[] = [];
  const slotWarn = () =>
    warn(
      WarningCode.SLOT_HISTORY_UNAVAILABLE,
      'Per-appointment slot history is not stored; slot events are inferred.',
      WarningSeverity.INFO,
    );

  const add = (key: string, eventType: LifecycleEventType, label: string, ts: number | null) => {
    const id = nodeId(LifecyclePhase.SLOT, 'timeslotslog', slotId, key);
    nodes.push(
      mkNode({
        id,
        phase: LifecyclePhase.SLOT,
        eventType,
        label,
        timestamp: ts,
        timestampConfidence: ts != null ? TimestampConfidence.INFERRED : TimestampConfidence.MISSING,
        nodeStatus: NodeStatus.PARTIAL,
        sourceCollection: 'timeslotslog',
        sourceRecordId: slotId,
        parentId: rootNodeId,
        summary: { start: slot?.start, end: slot?.end, status: slot?.status },
        warnings: [slotWarn()],
      }),
    );
    edges.push(edge(rootNodeId, id, EdgeStatus.INFERRED));
  };

  add('reserved', LifecycleEventType.SLOT_RESERVED, 'Slot reserved', normalizeTimestamp(appt.bookingDate ?? appt.createdAt));
  if (bundle.visit?.status === 'COMPLETED') {
    add('completed', LifecycleEventType.SLOT_COMPLETED, 'Slot completed', normalizeTimestamp(bundle.visit.completedAt));
  }
  if (appt.cancelledAt) {
    add('released', LifecycleEventType.SLOT_RELEASED, 'Slot released', normalizeTimestamp(appt.cancelledAt));
  }

  return { nodes, edges };
}

// ── COMMUNICATIONS (separate, weak) ─────────────────────────────────────---
// Notifications are communication records, not primary state. They are linked
// best-effort (payload-embedded appointmentId) and kept off the main causal path.
function buildCommunicationsPhase(bundle: LifecycleBundle, rootNodeId: string): BuiltBranch {
  const nodes: LifecycleNode[] = [];
  const edges: LifecycleEdge[] = [];

  for (const n of bundle.notifications ?? []) {
    const nId = String(n._id);
    const id = nodeId(LifecyclePhase.COMMUNICATION, 'notifications', nId, 'sent');
    nodes.push(
      mkNode({
        id,
        phase: LifecyclePhase.COMMUNICATION,
        eventType: LifecycleEventType.NOTIFICATION_SENT,
        label: n.title ?? n.type ?? 'Notification sent',
        timestamp: normalizeTimestamp(n.createdAt),
        sourceCollection: 'notifications',
        sourceRecordId: nId,
        parentId: rootNodeId,
        actor: systemActor(),
        summary: { type: n.type, recipientEmail: n.recipientEmail, recipientRole: n.recipientRole },
      }),
    );
    edges.push(edge(rootNodeId, id, EdgeStatus.WEAK_LINK));
  }

  return { nodes, edges };
}

// ── CANCELLATION / RESCHEDULE ───────────────────────────────────────────---
function buildCancellationPhase(bundle: LifecycleBundle, rootNodeId: string): BuiltBranch {
  const appt = bundle.appointment;
  if (appt.appointmentStatus !== 'CANCELLED' && !appt.cancelledAt) {
    return { nodes: [], edges: [] };
  }
  const apptId = String(appt._id);
  const id = nodeId(LifecyclePhase.CANCELLATION, 'appointments', apptId, 'cancelled');
  const actorEnum = appt.cancellationActor;
  const actor =
    !actorEnum
      ? systemActor()
      : String(actorEnum).toUpperCase() === 'SYSTEM'
        ? systemActor()
        : roleInferredActor(String(actorEnum));

  const node = mkNode({
    id,
    phase: LifecyclePhase.CANCELLATION,
    eventType: LifecycleEventType.APPOINTMENT_CANCELLED,
    label: 'Appointment cancelled',
    timestamp: normalizeTimestamp(appt.cancelledAt),
    statusAfter: 'CANCELLED',
    actor,
    sourceCollection: 'appointments',
    sourceRecordId: apptId,
    parentId: rootNodeId,
    summary: { reasonCode: appt.cancellationReasonCode, reason: appt.cancellationReason },
  });
  return { nodes: [node], edges: [edge(rootNodeId, id, EdgeStatus.STRONG_LINK)] };
}

function buildReschedulePhase(bundle: LifecycleBundle, rootNodeId: string): BuiltBranch {
  const appt = bundle.appointment;
  // Reschedule overwrites schedule in place; the only durable signals are a
  // RESCHEDULED status or a reschedule notification.
  const rescheduleNotif = (bundle.notifications ?? []).find((n) =>
    String(n?.type ?? '').toUpperCase().includes('RESCHEDUL'),
  );
  if (appt.appointmentStatus !== 'RESCHEDULED' && !rescheduleNotif) {
    return { nodes: [], edges: [] };
  }
  const apptId = String(appt._id);
  const id = nodeId(LifecyclePhase.RESCHEDULE, 'appointments', apptId, 'rescheduled');
  const ts = normalizeTimestamp(rescheduleNotif?.createdAt ?? appt.updatedAt);
  const node = mkNode({
    id,
    phase: LifecyclePhase.RESCHEDULE,
    eventType: LifecycleEventType.APPOINTMENT_RESCHEDULED,
    label: 'Appointment rescheduled',
    timestamp: ts,
    timestampConfidence: ts != null ? TimestampConfidence.INFERRED : TimestampConfidence.MISSING,
    nodeStatus: NodeStatus.PARTIAL,
    sourceCollection: 'appointments',
    sourceRecordId: apptId,
    parentId: rootNodeId,
    warnings: [
      warn(
        WarningCode.RESCHEDULE_HISTORY_UNAVAILABLE,
        'Reschedule overwrites schedule in place; prior schedule is not retained.',
        WarningSeverity.INFO,
      ),
    ],
  });
  return { nodes: [node], edges: [edge(rootNodeId, id, EdgeStatus.INFERRED)] };
}

// ── ASSEMBLY ────────────────────────────────────────────────────────────---
const PHASE_STATUS_RANK: Record<NodeStatus, number> = {
  [NodeStatus.CONFLICT]: 5,
  [NodeStatus.MISSING]: 4,
  [NodeStatus.UNKNOWN]: 3,
  [NodeStatus.LEGACY]: 2,
  [NodeStatus.PARTIAL]: 1,
  [NodeStatus.OK]: 0,
};

function rollupPhaseStatus(nodes: LifecycleNode[]): NodeStatus {
  let worst: NodeStatus = NodeStatus.OK;
  for (const n of nodes) {
    if (PHASE_STATUS_RANK[n.nodeStatus] > PHASE_STATUS_RANK[worst]) worst = n.nodeStatus;
  }
  return worst;
}

function buildPhaseSummaries(nodes: LifecycleNode[]): LifecyclePhaseSummary[] {
  const byPhase = new Map<LifecyclePhase, LifecycleNode[]>();
  for (const n of nodes) {
    const list = byPhase.get(n.phase) ?? [];
    list.push(n);
    byPhase.set(n.phase, list);
  }
  const summaries: LifecyclePhaseSummary[] = [];
  for (const [phase, list] of byPhase.entries()) {
    summaries.push({ phase, status: rollupPhaseStatus(list), nodeCount: list.length });
  }
  return summaries.sort((a, b) => (PHASE_ORDER[a.phase] ?? 99) - (PHASE_ORDER[b.phase] ?? 99));
}

// Pure reconstruction of the appointment lifecycle tree from a plain data bundle.
export function reconstructLifecycle(bundle: LifecycleBundle, now: number = Date.now()): LifecycleTree {
  const appt = bundle.appointment;
  const apptId = String(appt._id);

  const booking = buildBookingPhase(bundle);
  const rootNodeId = booking.rootNodeId;

  const nodes: LifecycleNode[] = [...booking.nodes];
  const edges: LifecycleEdge[] = [];
  const globalWarnings: LifecycleWarning[] = [];

  const branches: BuiltBranch[] = [
    buildDepositPhase(bundle, rootNodeId),
    buildAssignmentPhase(bundle, rootNodeId),
    buildConfirmationPhase(bundle, rootNodeId),
    buildVisitPhase(bundle, rootNodeId),
    buildEncounterPhase(bundle, rootNodeId),
    buildBillingPhase(bundle, rootNodeId),
    buildPaymentPhase(bundle, rootNodeId),
    buildSlotPhase(bundle, rootNodeId),
    buildCommunicationsPhase(bundle, rootNodeId),
    buildCancellationPhase(bundle, rootNodeId),
    buildReschedulePhase(bundle, rootNodeId),
  ];
  for (const b of branches) {
    nodes.push(...b.nodes);
    edges.push(...b.edges);
    if (b.warnings?.length) globalWarnings.push(...b.warnings);
  }

  // Conservative conflict detection: surfaces warnings + CONFLICT/PARTIAL flags,
  // never aborts. Mutates node statuses in place and may add placeholder nodes.
  const conflicts = applyConflicts(bundle, nodes, rootNodeId);
  nodes.push(...conflicts.extraNodes);
  edges.push(...conflicts.extraEdges);
  globalWarnings.push(...conflicts.globalWarnings);

  const sorted = sortNodesStable(nodes);

  return {
    appointment: {
      id: apptId,
      appointmentStatus: appt.appointmentStatus,
      assignmentStatus: appt.assignmentStatus,
      paymentCategory: appt.paymentCategory,
      depositStatus: appt.depositStatus,
      scheduledAt: normalizeTimestamp(appt.scheduledAt),
      bookingDate: normalizeTimestamp(appt.bookingDate),
    },
    rootNodeId,
    nodes: sorted,
    edges,
    phases: buildPhaseSummaries(sorted),
    globalWarnings,
    reconstruction: {
      strategy: 'DOMAIN_FIRST',
      generatedAt: now,
      partial: (bundle.failedBranches?.length ?? 0) > 0,
    },
  };
}
