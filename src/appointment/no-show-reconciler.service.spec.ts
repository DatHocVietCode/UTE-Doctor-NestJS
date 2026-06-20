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

import { CancellationActor } from './enums/cancellation-actor.enum';
import { NoShowSource } from './enums/no-show-source.enum';
import { NoShowReconcilerService } from './no-show-reconciler.service';

function createReconciler(input: {
  acquired?: boolean;
  candidateIds?: string[];
  dailyHour?: string;
} = {}) {
  const redisService = {
    acquireSlotLock: jest.fn().mockResolvedValue(input.acquired ?? true),
    releaseSlotLock: jest.fn().mockResolvedValue(undefined),
  };
  const appointmentService = {
    findNoShowCandidateIds: jest.fn().mockResolvedValue(input.candidateIds ?? []),
    markAppointmentNoShow: jest.fn().mockResolvedValue({ noShow: true, appointmentId: 'x' }),
    processDeferredNoShowEmails: jest.fn().mockResolvedValue(0),
  };
  const config = { get: jest.fn().mockReturnValue(input.dailyHour) };

  const reconciler = new NoShowReconcilerService(
    redisService as any,
    appointmentService as any,
    config as any,
  );
  return { reconciler, redisService, appointmentService };
}

describe('NoShowReconcilerService.reconcile', () => {
  it('marks each candidate (actor SYSTEM, given source) then runs the deferred-email pass under a lock', async () => {
    const { reconciler, redisService, appointmentService } = createReconciler({
      candidateIds: ['a1', 'a2'],
    });

    await reconciler.reconcile(NoShowSource.DAILY_06AM, 1_000);

    expect(redisService.acquireSlotLock).toHaveBeenCalled();
    expect(appointmentService.markAppointmentNoShow).toHaveBeenCalledTimes(2);
    expect(appointmentService.markAppointmentNoShow).toHaveBeenCalledWith(
      { appointmentId: 'a1', actor: CancellationActor.SYSTEM, source: NoShowSource.DAILY_06AM },
      1_000,
    );
    expect(appointmentService.processDeferredNoShowEmails).toHaveBeenCalledWith(1_000);
    expect(redisService.releaseSlotLock).toHaveBeenCalled();
  });

  it('does nothing when the Redis lock is not acquired', async () => {
    const { reconciler, appointmentService } = createReconciler({ acquired: false });
    await reconciler.reconcile(NoShowSource.STARTUP, 1_000);
    expect(appointmentService.findNoShowCandidateIds).not.toHaveBeenCalled();
    expect(appointmentService.markAppointmentNoShow).not.toHaveBeenCalled();
  });
});

describe('NoShowReconcilerService.msUntilNextDailyRun', () => {
  it('schedules the next local 06:00 later the same day when now is before 06:00', () => {
    const { reconciler } = createReconciler();
    // 20/06 03:00 local (= 19/06 20:00 UTC). Next 06:00 local is 3h away.
    const now = Date.UTC(2026, 5, 19, 20, 0, 0);
    expect(reconciler.msUntilNextDailyRun(now)).toBe(3 * 60 * 60 * 1000);
  });

  it('rolls to the next day when now is past 06:00', () => {
    const { reconciler } = createReconciler();
    // 20/06 10:00 local (= 20/06 03:00 UTC). Next 06:00 local is 21/06, i.e. 20h away.
    const now = Date.UTC(2026, 5, 20, 3, 0, 0);
    expect(reconciler.msUntilNextDailyRun(now)).toBe(20 * 60 * 60 * 1000);
  });
});
