jest.mock('src/patient/schema/medical-record.schema', () => ({
  MedicalEncounter: class MedicalEncounter {},
  MedicalProfile: class MedicalProfile {},
}));
jest.mock('./schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('src/billing/billing.schema', () => ({ Billing: class Billing {} }));
jest.mock('src/doctor/schema/doctor.schema', () => ({ Doctor: class Doctor {} }));
jest.mock('src/patient/schema/patient.schema', () => ({ Patient: class Patient {} }));
jest.mock('src/payment/schemas/payment.schema', () => ({ Payment: class Payment {} }));
jest.mock('src/profile/schema/profile.schema', () => ({ Profile: class Profile {} }));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({ TimeSlotLog: class TimeSlotLog {} }));
jest.mock('src/visit/schemas/visit.schema', () => ({ Visit: class Visit {} }));
jest.mock('./schemas/appointment-assignment-task.schema', () => ({ AppointmentAssignmentTask: class AppointmentAssignmentTask {} }));

import { VisitStatus } from 'src/visit/enums/visit-status.enum';
import { AppointmentService } from './appointment.service';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { AssignmentStatus } from './enums/assignment-status.enum';
import { CancellationActor } from './enums/cancellation-actor.enum';
import { DepositStatus } from './enums/deposit-status.enum';
import { NoShowSource } from './enums/no-show-source.enum';
import { PaymentCategory } from './enums/payment-category.enum';

const appointmentId = '64b000000000000000000001';
const visitId = '64b000000000000000000002';
const timeSlotId = '64b000000000000000000003';
const patientId = '64b000000000000000000004';
const staffAccountId = '64b000000000000000000005';

// 19/06/2026 09:00 (end 09:30) local — well in the past relative to the run times below.
const PAST_END = Date.UTC(2026, 5, 19, 2, 30, 0); // 09:30 +07
// A run time at local 10:00 (within business hours) so emails fire immediately.
const NOW_IN_HOURS = Date.UTC(2026, 5, 20, 3, 0, 0); // 10:00 +07
// A run time at local 03:00 (outside business hours) so emails defer.
const NOW_OUT_OF_HOURS = Date.UTC(2026, 5, 19, 20, 0, 0); // 03:00 +07 next day

function queryResult<T>(value: T) {
  return {
    session: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createAppointment(overrides: Record<string, any> = {}) {
  return {
    _id: appointmentId,
    appointmentStatus: AppointmentStatus.CONFIRMED,
    assignmentStatus: AssignmentStatus.ASSIGNED,
    scheduledAt: PAST_END - 30 * 60_000,
    endTime: PAST_END,
    timeSlot: { toString: () => timeSlotId },
    patientId: { toString: () => patientId },
    patientEmail: 'patient@example.com',
    doctorId: 'doctor-1',
    hospitalName: 'UTE Clinic',
    paymentCategory: PaymentCategory.BHYT,
    depositPaidAmount: 0,
    depositStatus: DepositStatus.NOT_REQUIRED,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createService(input: {
  appointment?: any;
  visit?: any;
  encounterExists?: any;
  billing?: any;
} = {}) {
  const session = {
    withTransaction: jest.fn(async (cb: () => Promise<void>) => cb()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const appointment = input.appointment ?? createAppointment();
  const visit =
    'visit' in input
      ? input.visit
      : { _id: visitId, status: VisitStatus.CREATED, save: jest.fn().mockResolvedValue(undefined) };

  // findById is used both inside the txn (.session) and after commit (.exec); same doc both times.
  const apptQuery = {
    session: jest.fn().mockResolvedValue(appointment),
    exec: jest.fn().mockResolvedValue(appointment),
  };
  const appointmentModel = {
    db: { startSession: jest.fn().mockResolvedValue(session) },
    findById: jest.fn().mockReturnValue(apptQuery),
    find: jest.fn().mockReturnValue({ ...queryResult([]), limit: jest.fn().mockReturnThis() }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const eventEmitter = { emit: jest.fn() };
  const doctorModel = {
    findById: jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ profileId: { email: 'doctor@example.com', name: 'Dr. A' } }),
      }),
    }),
  };
  const visitModel = { findOne: jest.fn().mockReturnValue(queryResult(visit)) };
  const medicalEncounterModel = {
    exists: jest.fn().mockReturnValue({ session: jest.fn().mockResolvedValue(input.encounterExists ?? null) }),
  };
  const billingModel = { findOne: jest.fn().mockReturnValue(queryResult(input.billing ?? null)) };
  const timeSlotLogModel = {
    findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ label: '09:00-09:30' }) }),
  };
  const creditService = { refundAppointmentCancellation: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(undefined) };

  const service = new AppointmentService(
    eventEmitter as any,
    appointmentModel as any,
    timeSlotLogModel as any,
    {} as any,
    doctorModel as any,
    {} as any,
    visitModel as any,
    medicalEncounterModel as any,
    billingModel as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    creditService as any,
    config as any,
  );

  return { service, appointment, visit, eventEmitter, creditService };
}

function emitted(eventEmitter: any, name: string): boolean {
  return eventEmitter.emit.mock.calls.some((c: any[]) => c[0] === name);
}

describe('AppointmentService.markAppointmentNoShow', () => {
  it('marks a past confirmed appointment with no check-in as NO_SHOW (+ visit NO_SHOW)', async () => {
    const { service, appointment, visit, eventEmitter } = createService();

    const res = await service.markAppointmentNoShow(
      { appointmentId, actor: CancellationActor.SYSTEM, source: NoShowSource.DAILY_06AM },
      NOW_IN_HOURS,
    );

    expect(res.noShow).toBe(true);
    expect(appointment.appointmentStatus).toBe(AppointmentStatus.NO_SHOW);
    expect(appointment.noShowActor).toBe(CancellationActor.SYSTEM);
    expect(appointment.noShowSource).toBe(NoShowSource.DAILY_06AM);
    expect(visit.status).toBe(VisitStatus.NO_SHOW);
    expect(emitted(eventEmitter, 'notify.appointment.no_show')).toBe(true);
    expect(emitted(eventEmitter, 'socket.appointment.no_show')).toBe(true);
    expect(emitted(eventEmitter, 'mail.patient.appointment.no_show')).toBe(true);
  });

  it('forfeits a paid DICH_VU deposit without refunding', async () => {
    const { service, appointment, creditService } = createService({
      appointment: createAppointment({
        paymentCategory: PaymentCategory.DICH_VU,
        depositStatus: DepositStatus.PAID,
        depositPaidAmount: 50000,
      }),
    });

    const res = await service.markAppointmentNoShow(
      { appointmentId, actor: CancellationActor.SYSTEM, source: NoShowSource.DAILY_06AM },
      NOW_IN_HOURS,
    );

    expect(res.noShow).toBe(true);
    expect(appointment.depositStatus).toBe(DepositStatus.FORFEITED);
    expect(creditService.refundAppointmentCancellation).not.toHaveBeenCalled();
  });

  it('does not mark a checked-in visit', async () => {
    const { service, appointment } = createService({
      visit: { _id: visitId, status: VisitStatus.CHECKED_IN, save: jest.fn() },
    });

    const res = await service.markAppointmentNoShow(
      { appointmentId, actor: CancellationActor.SYSTEM, source: NoShowSource.DAILY_06AM },
      NOW_IN_HOURS,
    );

    expect(res.noShow).toBe(false);
    expect(res.reason).toBe('VISIT_CHECKED_IN');
    expect(appointment.appointmentStatus).toBe(AppointmentStatus.CONFIRMED);
  });

  it('does not mark when an encounter exists', async () => {
    const { service } = createService({ encounterExists: { _id: 'enc' } });
    const res = await service.markAppointmentNoShow(
      { appointmentId, actor: CancellationActor.SYSTEM, source: NoShowSource.DAILY_06AM },
      NOW_IN_HOURS,
    );
    expect(res.noShow).toBe(false);
    expect(res.reason).toBe('ENCOUNTER_EXISTS');
  });

  it('does not mark a not-yet-elapsed appointment', async () => {
    const { service } = createService({
      appointment: createAppointment({ endTime: NOW_IN_HOURS + 60 * 60_000 }),
    });
    const res = await service.markAppointmentNoShow(
      { appointmentId, actor: CancellationActor.SYSTEM, source: NoShowSource.DAILY_06AM },
      NOW_IN_HOURS,
    );
    expect(res.noShow).toBe(false);
    expect(res.reason).toBe('NOT_OVERDUE');
  });

  it('is idempotent: an already-NO_SHOW appointment is a safe no-op', async () => {
    const { service, appointment } = createService({
      appointment: createAppointment({ appointmentStatus: AppointmentStatus.NO_SHOW }),
    });
    const res = await service.markAppointmentNoShow(
      { appointmentId, actor: CancellationActor.SYSTEM, source: NoShowSource.DAILY_06AM },
      NOW_IN_HOURS,
    );
    expect(res.noShow).toBe(false);
    expect(res.alreadyNoShow).toBe(true);
    expect(appointment.save).not.toHaveBeenCalled();
  });

  it('defers the patient email when run outside business hours (in-app + socket still fire)', async () => {
    const { service, appointment, eventEmitter } = createService();

    const res = await service.markAppointmentNoShow(
      { appointmentId, actor: CancellationActor.SYSTEM, source: NoShowSource.STARTUP },
      NOW_OUT_OF_HOURS,
    );

    expect(res.noShow).toBe(true);
    expect(appointment.noShowNotifiedAt).toBeUndefined();
    expect(emitted(eventEmitter, 'notify.appointment.no_show')).toBe(true);
    expect(emitted(eventEmitter, 'socket.appointment.no_show')).toBe(true);
    expect(emitted(eventEmitter, 'mail.patient.appointment.no_show')).toBe(false);
  });

  it('emails immediately for a manual staff action even outside business hours', async () => {
    const { service, appointment, eventEmitter } = createService();

    const res = await service.markAppointmentNoShow(
      {
        appointmentId,
        actor: CancellationActor.STAFF,
        source: NoShowSource.MANUAL,
        markedByAccountId: staffAccountId,
      },
      NOW_OUT_OF_HOURS,
    );

    expect(res.noShow).toBe(true);
    expect(appointment.noShowActor).toBe(CancellationActor.STAFF);
    expect(appointment.noShowMarkedByAccountId?.toString()).toBe(staffAccountId);
    expect(emitted(eventEmitter, 'mail.patient.appointment.no_show')).toBe(true);
  });
});

describe('AppointmentService.isAppointmentActionable', () => {
  it('is false for a past confirmed appointment, true for a future one', () => {
    const { service } = createService();
    expect(service.isAppointmentActionable(createAppointment(), NOW_IN_HOURS)).toBe(false);
    expect(
      service.isAppointmentActionable(createAppointment({ endTime: NOW_IN_HOURS + 3_600_000 }), NOW_IN_HOURS),
    ).toBe(true);
  });

  it('keeps a broad awaiting-assignment appointment actionable despite its placeholder time', () => {
    const { service } = createService();
    const broad = createAppointment({
      appointmentStatus: AppointmentStatus.PENDING,
      assignmentStatus: AssignmentStatus.AWAITING_ASSIGNMENT,
      endTime: undefined,
      scheduledAt: PAST_END,
    });
    expect(service.isAppointmentActionable(broad, NOW_IN_HOURS)).toBe(true);
  });

  it('is false for terminal statuses', () => {
    const { service } = createService();
    expect(
      service.isAppointmentActionable(createAppointment({ appointmentStatus: AppointmentStatus.NO_SHOW }), NOW_IN_HOURS),
    ).toBe(false);
  });
});
