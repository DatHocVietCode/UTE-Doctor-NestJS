import { LifecycleEventType } from '../enums/lifecycle-event-type.enum';
import { LifecyclePhase } from '../enums/lifecycle-phase.enum';
import { NodeStatus } from '../enums/node-status.enum';
import { EdgeStatus } from '../enums/edge-status.enum';
import { ActorSource, ActorType, TimestampConfidence } from '../enums/actor.enums';
import { WarningCode } from '../enums/warning.enums';
import { emptyLookups, LifecycleBundle } from '../dto/lifecycle-bundle';
import { reconstructLifecycle } from './lifecycle-phase-builders';

function nodeOfType(tree: ReturnType<typeof reconstructLifecycle>, eventType: string) {
  return tree.nodes.find((n) => n.eventType === eventType);
}
function edgeTo(tree: ReturnType<typeof reconstructLifecycle>, nodeId: string) {
  return tree.edges.find((e) => e.to === nodeId);
}

function baseBundle(overrides: Partial<LifecycleBundle> = {}): LifecycleBundle {
  return {
    appointment: {
      _id: 'appt1',
      appointmentStatus: 'CONFIRMED',
      assignmentStatus: 'NONE',
      paymentCategory: 'DICH_VU',
      depositStatus: 'PAID',
      createdAt: new Date(1000),
      bookingDate: 1000,
      scheduledAt: 5000,
      patientEmail: 'patient@example.com',
    },
    depositPayments: [],
    billingPayments: [],
    assignmentTasks: [],
    visit: null,
    encounter: null,
    billing: null,
    timeSlot: null,
    creditTransactions: [],
    coinTransactions: [],
    notifications: [],
    lookups: emptyLookups(),
    ...overrides,
  };
}

describe('reconstructLifecycle', () => {
  it('builds a BOOKING root node from the appointment (tracer)', () => {
    const tree = reconstructLifecycle(baseBundle(), 9999);

    const root = tree.nodes.find((n) => n.id === tree.rootNodeId);
    expect(root).toBeDefined();
    expect(root!.phase).toBe(LifecyclePhase.BOOKING);
    expect(root!.eventType).toBe(LifecycleEventType.APPOINTMENT_CREATED);
    expect(root!.timestamp).toBe(1000);
    expect(root!.nodeStatus).toBe(NodeStatus.OK);
    expect(tree.appointment.id).toBe('appt1');
    expect(tree.reconstruction.strategy).toBe('DOMAIN_FIRST');
  });

  it('reconstructs a NO_SHOW terminal node + VISIT_NO_SHOW from durable markers (SYSTEM)', () => {
    const tree = reconstructLifecycle(
      baseBundle({
        appointment: {
          _id: 'appt1',
          appointmentStatus: 'NO_SHOW',
          assignmentStatus: 'ASSIGNED',
          paymentCategory: 'DICH_VU',
          depositStatus: 'FORFEITED',
          createdAt: new Date(500),
          bookingDate: 500,
          scheduledAt: 5000,
          noShowAt: 9000,
          noShowActor: 'SYSTEM',
          noShowSource: 'DAILY_06AM',
        },
        visit: { _id: 'v1', status: 'NO_SHOW', createdAt: new Date(6000), updatedAt: new Date(9000) },
      }),
    );

    const noShow = nodeOfType(tree, LifecycleEventType.APPOINTMENT_NO_SHOW);
    expect(noShow).toBeDefined();
    expect(noShow!.phase).toBe(LifecyclePhase.NO_SHOW);
    expect(noShow!.timestamp).toBe(9000);
    expect(noShow!.actor?.actorType).toBe(ActorType.SYSTEM);
    expect(edgeTo(tree, noShow!.id)?.edgeStatus).toBe(EdgeStatus.STRONG_LINK);

    // The forfeited deposit and the no-show visit also surface, and confirmation still shows.
    expect(nodeOfType(tree, LifecycleEventType.DEPOSIT_FORFEITED)).toBeDefined();
    expect(nodeOfType(tree, LifecycleEventType.VISIT_NO_SHOW)).toBeDefined();
    expect(nodeOfType(tree, LifecycleEventType.APPOINTMENT_CONFIRMED)).toBeDefined();
  });

  it('attributes a manual NO_SHOW to a staff user, not the system', () => {
    const tree = reconstructLifecycle(
      baseBundle({
        appointment: {
          _id: 'appt1',
          appointmentStatus: 'NO_SHOW',
          assignmentStatus: 'ASSIGNED',
          paymentCategory: 'BHYT',
          depositStatus: 'NOT_REQUIRED',
          createdAt: new Date(500),
          bookingDate: 500,
          scheduledAt: 5000,
          noShowAt: 9000,
          noShowActor: 'STAFF',
          noShowMarkedByAccountId: 'acc-1',
          noShowSource: 'MANUAL',
        },
        visit: { _id: 'v1', status: 'NO_SHOW', createdAt: new Date(6000), updatedAt: new Date(9000) },
      }),
    );

    const noShow = nodeOfType(tree, LifecycleEventType.APPOINTMENT_NO_SHOW);
    expect(noShow!.actor?.actorType).toBe(ActorType.USER);
    expect(noShow!.actor?.actorId).toBe('acc-1');
  });

  it('emits a DEPOSIT_PAID node with a STRONG_LINK edge when the deposit is paid', () => {
    const tree = reconstructLifecycle(
      baseBundle({
        appointment: {
          _id: 'appt1',
          appointmentStatus: 'CONFIRMED',
          assignmentStatus: 'NONE',
          paymentCategory: 'DICH_VU',
          depositStatus: 'PAID',
          depositPaidAt: 1000,
          depositPaymentId: 'pay1',
          createdAt: new Date(500),
          bookingDate: 500,
        },
        depositPayments: [
          {
            _id: 'pay1',
            purpose: 'APPOINTMENT_DEPOSIT',
            status: 'SUCCESS',
            amount: 100000,
            appointmentId: 'appt1',
            createdAt: new Date(700),
            paidAt: new Date(1000),
          },
        ],
      }),
    );

    const paid = nodeOfType(tree, LifecycleEventType.DEPOSIT_PAID);
    expect(paid).toBeDefined();
    expect(paid!.phase).toBe(LifecyclePhase.DEPOSIT);
    expect(paid!.timestamp).toBe(1000);
    expect(paid!.nodeStatus).toBe(NodeStatus.OK);
    expect(edgeTo(tree, paid!.id)!.edgeStatus).toBe(EdgeStatus.STRONG_LINK);
  });

  it('derives assignment transition nodes from task history, with actor from the history `by`', () => {
    const tree = reconstructLifecycle(
      baseBundle({
        appointment: {
          _id: 'appt1',
          appointmentStatus: 'CONFIRMED',
          assignmentStatus: 'ASSIGNED',
          paymentCategory: 'DICH_VU',
          depositStatus: 'PAID',
          depositPaidAt: 150,
          createdAt: new Date(50),
          bookingDate: 50,
        },
        assignmentTasks: [
          {
            _id: 'task1',
            appointmentId: 'appt1',
            status: 'COMPLETED',
            createdAt: new Date(100),
            history: [
              { at: 100, from: 'NONE', to: 'PENDING', by: 'system' },
              { at: 200, from: 'PENDING', to: 'ASSIGNED', by: 'recep1' },
              { at: 300, from: 'ASSIGNED', to: 'COMPLETED', by: 'recep1' },
            ],
          },
        ],
      }),
    );

    const assigned = tree.nodes.find(
      (n) => n.phase === LifecyclePhase.ASSIGNMENT && n.statusAfter === 'ASSIGNED',
    );
    expect(assigned).toBeDefined();
    expect(assigned!.timestamp).toBe(200);
    expect(assigned!.actor.actorId).toBe('recep1');
    expect(assigned!.actor.actorType).toBe(ActorType.USER);
    expect(assigned!.actor.actorSource).toBe(ActorSource.STORED_FIELD);
    expect(edgeTo(tree, assigned!.id)!.edgeStatus).toBe(EdgeStatus.STRONG_LINK);

    // A 'system' transition is attributed to SYSTEM, not a user.
    const created = tree.nodes.find(
      (n) => n.phase === LifecyclePhase.ASSIGNMENT && n.statusAfter === 'PENDING',
    );
    expect(created!.actor.actorType).toBe(ActorType.SYSTEM);
  });

  it('emits a CONFIRMATION node when the appointment is confirmed', () => {
    const tree = reconstructLifecycle(baseBundle());
    const conf = nodeOfType(tree, LifecycleEventType.APPOINTMENT_CONFIRMED);
    expect(conf).toBeDefined();
    expect(conf!.phase).toBe(LifecyclePhase.CONFIRMATION);
  });

  it('builds visit nodes with a no-checkin-timestamp warning and a doctor actor on completion', () => {
    const tree = reconstructLifecycle(
      baseBundle({
        visit: {
          _id: 'visit1',
          appointmentId: 'appt1',
          doctorId: 'doc1',
          status: 'COMPLETED',
          createdAt: new Date(2000),
          startedAt: 3000,
          completedAt: 4000,
        },
        lookups: {
          doctors: new Map([['doc1', { name: 'Dr. House', email: 'house@h.com' }]]),
          patients: new Map(),
          accounts: new Map(),
          receptionists: new Map(),
        },
      }),
    );

    const created = nodeOfType(tree, LifecycleEventType.VISIT_CREATED);
    expect(created).toBeDefined();
    expect(edgeTo(tree, created!.id)!.edgeStatus).toBe(EdgeStatus.STRONG_LINK);

    const completed = nodeOfType(tree, LifecycleEventType.VISIT_COMPLETED);
    expect(completed!.timestamp).toBe(4000);
    expect(completed!.actor.actorType).toBe(ActorType.USER);
    expect(completed!.actor.actorId).toBe('doc1');
    expect(completed!.actor.actorName).toBe('Dr. House');

    const checkedIn = nodeOfType(tree, LifecycleEventType.VISIT_CHECKED_IN);
    expect(checkedIn).toBeDefined();
    expect(checkedIn!.nodeStatus).toBe(NodeStatus.PARTIAL);
    expect(checkedIn!.warnings.some((w) => w.code === WarningCode.NO_CHECKIN_TIMESTAMP)).toBe(true);
  });

  it('emits an ENCOUNTER_CREATED node with an exact stored doctor actor', () => {
    const tree = reconstructLifecycle(
      baseBundle({
        encounter: {
          _id: 'enc1',
          appointmentId: 'appt1',
          visitId: 'visit1',
          createdByDoctorId: 'doc1',
          createdByAccountId: 'acc1',
          createdByRole: 'DOCTOR',
          diagnosis: 'flu',
          dateRecord: new Date(4500),
          createdAt: new Date(4500),
        },
        lookups: {
          doctors: new Map(),
          patients: new Map(),
          accounts: new Map([['acc1', { name: 'Dr. House', email: 'house@h.com' }]]),
          receptionists: new Map(),
        },
      }),
    );

    const enc = nodeOfType(tree, LifecycleEventType.ENCOUNTER_CREATED);
    expect(enc).toBeDefined();
    expect(enc!.actor.actorType).toBe(ActorType.USER);
    expect(enc!.actor.actorSource).toBe(ActorSource.STORED_FIELD);
    expect(enc!.actor.actorId).toBe('acc1');
  });

  const completedBundle = (overrides: Partial<LifecycleBundle> = {}) =>
    baseBundle({
      appointment: {
        _id: 'appt1',
        appointmentStatus: 'COMPLETED',
        assignmentStatus: 'NONE',
        paymentCategory: 'DICH_VU',
        depositStatus: 'PAID',
        depositPaidAt: 1000,
        createdAt: new Date(500),
        bookingDate: 500,
      },
      visit: { _id: 'visit1', appointmentId: 'appt1', doctorId: 'doc1', status: 'COMPLETED', createdAt: new Date(2000), startedAt: 3000, completedAt: 4000 },
      ...overrides,
    });

  it('emits billing nodes with a WEAK link when billing resolves only via visit', () => {
    const tree = reconstructLifecycle(
      completedBundle({
        billing: { _id: 'bill1', visitId: 'visit1', status: 'PAID', finalPayable: 85000, createdAt: new Date(5000), updatedAt: new Date(6000) },
        billingPayments: [
          { _id: 'bp1', billingId: 'bill1', purpose: 'BILLING', status: 'SUCCESS', method: 'QR', amount: 85000, createdAt: new Date(5500), paidAt: new Date(6000) },
        ],
      }),
    );

    const created = nodeOfType(tree, LifecycleEventType.BILLING_CREATED);
    expect(created).toBeDefined();
    expect(edgeTo(tree, created!.id)!.edgeStatus).toBe(EdgeStatus.WEAK_LINK);
    expect(created!.warnings.some((w) => w.code === WarningCode.WEAK_BILLING_LINK)).toBe(true);
    expect(nodeOfType(tree, LifecycleEventType.BILLING_PAID)).toBeDefined();
  });

  it('shows a MISSING billing placeholder when a completed visit has no billing', () => {
    const tree = reconstructLifecycle(completedBundle({ billing: null }));
    const billingNode = tree.nodes.find((n) => n.phase === LifecyclePhase.BILLING);
    expect(billingNode).toBeDefined();
    expect(billingNode!.nodeStatus).toBe(NodeStatus.MISSING);
    expect(billingNode!.warnings.some((w) => w.code === WarningCode.MISSING_BILLING)).toBe(true);
  });

  it('emits a PAYMENT_SUCCESS node for a billing payment with a WEAK (2-hop) link', () => {
    const tree = reconstructLifecycle(
      completedBundle({
        billing: { _id: 'bill1', visitId: 'visit1', status: 'PAID', finalPayable: 85000, createdAt: new Date(5000), updatedAt: new Date(6000) },
        billingPayments: [
          { _id: 'bp1', billingId: 'bill1', purpose: 'BILLING', status: 'SUCCESS', method: 'QR', amount: 85000, createdAt: new Date(5500), paidAt: new Date(6000) },
        ],
      }),
    );

    const success = nodeOfType(tree, LifecycleEventType.PAYMENT_SUCCESS);
    expect(success).toBeDefined();
    expect(success!.phase).toBe(LifecyclePhase.PAYMENT);
    expect(success!.timestamp).toBe(6000);
    expect(edgeTo(tree, success!.id)!.edgeStatus).toBe(EdgeStatus.WEAK_LINK);
  });

  it('builds an inferred SLOT_RESERVED node with a slot_history_unavailable warning', () => {
    const tree = reconstructLifecycle(
      baseBundle({
        appointment: { _id: 'appt1', appointmentStatus: 'CONFIRMED', assignmentStatus: 'NONE', paymentCategory: 'BHYT', depositStatus: 'NOT_REQUIRED', timeSlot: 'slot1', createdAt: new Date(500), bookingDate: 500 },
        timeSlot: { _id: 'slot1', start: '08:00', end: '09:00', status: 'booked' },
      }),
    );
    const reserved = nodeOfType(tree, LifecycleEventType.SLOT_RESERVED);
    expect(reserved).toBeDefined();
    expect(reserved!.phase).toBe(LifecyclePhase.SLOT);
    expect(edgeTo(tree, reserved!.id)!.edgeStatus).toBe(EdgeStatus.INFERRED);
    expect(reserved!.warnings.some((w) => w.code === WarningCode.SLOT_HISTORY_UNAVAILABLE)).toBe(true);
  });

  it('places notifications in a separate COMMUNICATION branch with WEAK links', () => {
    const tree = reconstructLifecycle(
      baseBundle({
        notifications: [
          { _id: 'n1', type: 'APPOINTMENT_DOCTOR_ASSIGNED', recipientEmail: 'p@e.com', createdAt: new Date(250), data: { appointmentId: 'appt1' } },
        ],
      }),
    );
    const notif = nodeOfType(tree, LifecycleEventType.NOTIFICATION_SENT);
    expect(notif).toBeDefined();
    expect(notif!.phase).toBe(LifecyclePhase.COMMUNICATION);
    expect(edgeTo(tree, notif!.id)!.edgeStatus).toBe(EdgeStatus.WEAK_LINK);
  });

  it('emits a cancellation node and a DEPOSIT_REFUNDED node from the credit ledger', () => {
    const tree = reconstructLifecycle(
      baseBundle({
        appointment: { _id: 'appt1', appointmentStatus: 'CANCELLED', assignmentStatus: 'NONE', paymentCategory: 'DICH_VU', depositStatus: 'REFUNDED', cancelledAt: 1500, cancellationActor: 'PATIENT', cancellationReasonCode: 'PATIENT_REQUEST', createdAt: new Date(500), bookingDate: 500 },
        creditTransactions: [
          { _id: 'ct1', appointmentId: 'appt1', type: 'credit', amount: 70000, reason: 'appointment_cancellation_refund', createdAt: new Date(1500) },
        ],
      }),
    );
    const cancel = nodeOfType(tree, LifecycleEventType.APPOINTMENT_CANCELLED);
    expect(cancel).toBeDefined();
    expect(cancel!.phase).toBe(LifecyclePhase.CANCELLATION);
    expect(cancel!.timestamp).toBe(1500);

    const refund = nodeOfType(tree, LifecycleEventType.DEPOSIT_REFUNDED);
    expect(refund).toBeDefined();
    expect(edgeTo(tree, refund!.id)!.edgeStatus).toBe(EdgeStatus.STRONG_LINK);
  });

  it('produces no deposit nodes for a BHYT / NOT_REQUIRED appointment', () => {
    const tree = reconstructLifecycle(
      baseBundle({
        appointment: { _id: 'appt1', appointmentStatus: 'CONFIRMED', assignmentStatus: 'NONE', paymentCategory: 'BHYT', depositStatus: 'NOT_REQUIRED', createdAt: new Date(500), bookingDate: 500 },
      }),
    );
    expect(tree.nodes.some((n) => n.phase === LifecyclePhase.DEPOSIT)).toBe(false);
    expect(nodeOfType(tree, LifecycleEventType.APPOINTMENT_CONFIRMED)).toBeDefined();
  });

  describe('conflict checks (never abort the tree)', () => {
    it('flags more than one active assignment task', () => {
      const tree = reconstructLifecycle(
        baseBundle({
          assignmentTasks: [
            { _id: 't1', appointmentId: 'appt1', status: 'PENDING', history: [{ at: 100, from: 'NONE', to: 'PENDING', by: 'system' }] },
            { _id: 't2', appointmentId: 'appt1', status: 'ASSIGNED', history: [{ at: 200, from: 'PENDING', to: 'ASSIGNED', by: 'recep1' }] },
          ],
        }),
      );
      expect(tree.globalWarnings.some((w) => w.code === WarningCode.CONFLICT_MULTIPLE_ACTIVE_TASKS)).toBe(true);
      expect(tree.nodes.some((n) => n.phase === LifecyclePhase.ASSIGNMENT && n.nodeStatus === NodeStatus.CONFLICT)).toBe(true);
      expect(tree.rootNodeId).toBeTruthy();
    });

    it('flags an appointment COMPLETED with no Visit and emits a CONFLICT placeholder', () => {
      const tree = reconstructLifecycle(
        baseBundle({
          appointment: { _id: 'appt1', appointmentStatus: 'COMPLETED', assignmentStatus: 'NONE', paymentCategory: 'BHYT', depositStatus: 'NOT_REQUIRED', createdAt: new Date(500), bookingDate: 500 },
          visit: null,
        }),
      );
      expect(tree.globalWarnings.some((w) => w.code === WarningCode.CONFLICT_COMPLETED_WITHOUT_VISIT)).toBe(true);
      expect(tree.nodes.some((n) => n.phase === LifecyclePhase.VISIT && n.nodeStatus === NodeStatus.CONFLICT)).toBe(true);
    });

    it('flags Billing PAID while appointment is not COMPLETED', () => {
      const tree = reconstructLifecycle(
        baseBundle({
          appointment: { _id: 'appt1', appointmentStatus: 'CONFIRMED', assignmentStatus: 'NONE', paymentCategory: 'DICH_VU', depositStatus: 'PAID', depositPaidAt: 1000, createdAt: new Date(500), bookingDate: 500 },
          depositPayments: [{ _id: 'p1', purpose: 'APPOINTMENT_DEPOSIT', status: 'SUCCESS', appointmentId: 'appt1', createdAt: new Date(700), paidAt: new Date(1000) }],
          visit: { _id: 'visit1', appointmentId: 'appt1', doctorId: 'doc1', status: 'COMPLETED', createdAt: new Date(2000), startedAt: 3000, completedAt: 4000 },
          billing: { _id: 'bill1', visitId: 'visit1', status: 'PAID', finalPayable: 85000, createdAt: new Date(5000), updatedAt: new Date(6000) },
        }),
      );
      expect(tree.globalWarnings.some((w) => w.code === WarningCode.CONFLICT_BILLING_PAID_APPOINTMENT_NOT_COMPLETED)).toBe(true);
      expect(nodeOfType(tree, LifecycleEventType.BILLING_PAID)!.nodeStatus).toBe(NodeStatus.CONFLICT);
    });

    it('flags depositStatus PAID but no deposit Payment row (TTL) as PARTIAL', () => {
      const tree = reconstructLifecycle(
        baseBundle({
          appointment: { _id: 'appt1', appointmentStatus: 'CONFIRMED', assignmentStatus: 'NONE', paymentCategory: 'DICH_VU', depositStatus: 'PAID', depositPaidAt: 1000, createdAt: new Date(500), bookingDate: 500 },
          depositPayments: [],
        }),
      );
      expect(tree.globalWarnings.some((w) => w.code === WarningCode.CONFLICT_DEPOSIT_PAID_WITHOUT_PAYMENT)).toBe(true);
      const paid = nodeOfType(tree, LifecycleEventType.DEPOSIT_PAID);
      expect(paid!.nodeStatus).toBe(NodeStatus.PARTIAL);
      expect(paid!.warnings.some((w) => w.code === WarningCode.PAYMENT_RECORD_EXPIRED)).toBe(true);
    });
  });

  describe('legacy / defensive reconstruction', () => {
    it('reconstructs a legacy date-only appointment (no scheduledAt/createdAt) without throwing', () => {
      const tree = reconstructLifecycle(
        baseBundle({
          appointment: { _id: 'legacy1', appointmentStatus: 'PENDING', paymentCategory: 'DICH_VU', depositStatus: 'NOT_REQUIRED', date: 4242 },
        }),
      );
      expect(tree.rootNodeId).toBeTruthy();
      expect(tree.appointment.scheduledAt).toBeNull();
      const root = tree.nodes.find((n) => n.id === tree.rootNodeId)!;
      expect(root.timestamp).toBeNull();
      expect(root.timestampConfidence).toBe(TimestampConfidence.MISSING);
    });

    it('marks a dangling doctor ref on the completed visit as REF_UNRESOLVED without throwing', () => {
      const tree = reconstructLifecycle(
        completedBundle({
          visit: { _id: 'visit1', appointmentId: 'appt1', doctorId: 'ghost', status: 'COMPLETED', createdAt: new Date(2000), startedAt: 3000, completedAt: 4000 },
        }),
      );
      const completed = nodeOfType(tree, LifecycleEventType.VISIT_COMPLETED)!;
      expect(completed.actor.actorId).toBe('ghost');
      expect(completed.actor.actorWarnings).toContain(WarningCode.REF_UNRESOLVED);
    });
  });
});
