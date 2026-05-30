// Schema mocks must be declared before any imports that reference them.
jest.mock('./schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('src/billing/billing.schema', () => ({ Billing: class Billing {} }));
jest.mock('src/patient/schema/medical-record.schema', () => ({
  MedicalEncounter: class MedicalEncounter {},
}));
jest.mock('src/payment/schemas/payment.schema', () => ({ Payment: class Payment {} }));
jest.mock('src/shift/schema/shift.schema', () => ({ Shift: class Shift {} }));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({
  TimeSlotLog: class TimeSlotLog {},
}));
jest.mock('src/visit/schemas/visit.schema', () => ({ Visit: class Visit {} }));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AppointmentRescheduleService } from './appointment-reschedule.service';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { VisitStatus } from 'src/visit/enums/visit-status.enum';
import { RescheduleInput } from './dto/appointment-reschedule.dto';

// ---- Test fixtures ----------------------------------------------------------

const appointmentId = '64b000000000000000000001';
const visitId = '64b000000000000000000002';
const oldSlotId = '64b000000000000000000003';
const newSlotId = '64b000000000000000000004';
const doctorId = '64b000000000000000000005';

// A future date ISO string for the new schedule.
const futureDate = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString().replace('Z', '+00:00');

const baseInput: RescheduleInput = {
  appointmentId,
  appointmentDate: futureDate,
  timeSlotId: newSlotId,
  reason: 'reschedule test',
  rescheduledBy: 'patient@example.com',
};

// ---- Helpers ----------------------------------------------------------------

function makeAppointment(overrides: Record<string, any> = {}) {
  return {
    _id: new Types.ObjectId(appointmentId),
    appointmentStatus: AppointmentStatus.CONFIRMED,
    scheduledAt: Date.now() + 48 * 60 * 60 * 1000,
    startTime: Date.now() + 48 * 60 * 60 * 1000,
    endTime: Date.now() + 48 * 60 * 60 * 1000 + 30 * 60 * 1000,
    timeSlot: new Types.ObjectId(oldSlotId),
    doctorId: new Types.ObjectId(doctorId),
    patientEmail: 'patient@example.com',
    bookingDate: Date.now() - 24 * 60 * 60 * 1000,
    paymentCategory: 'DICH_VU',
    depositAmount: 50000,
    depositPaidAmount: 50000,
    depositStatus: 'PAID',
    consultationFee: 200000,
    coinDiscountAmount: 0,
    paymentAmount: 150000,
    paymentMethod: 'QR',
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeVisit(status: VisitStatus = VisitStatus.CREATED, overrides: Record<string, any> = {}) {
  return { _id: new Types.ObjectId(visitId), status, ...overrides };
}

function makeSlot() {
  return { _id: new Types.ObjectId(newSlotId), start: '09:00', end: '09:30', status: 'available' };
}

// Builds a fully-wired service with controllable model mocks.
function createService(opts: {
  appointment?: any;
  freshAppointment?: any;
  visit?: any;
  encounterExists?: any;
  billing?: any;
  paymentExists?: any;
  slotConflict?: any;
  lockAcquired?: boolean;
  slot?: any;
  // null → SLOT_DOCTOR_MISMATCH; default truthy → slot belongs to doctor
  shiftExists?: any;
}) {
  // Use hasOwnProperty so callers can explicitly pass null to simulate "not found".
  const appt = Object.prototype.hasOwnProperty.call(opts, 'appointment') ? opts.appointment : makeAppointment();
  const freshAppt = Object.prototype.hasOwnProperty.call(opts, 'freshAppointment') ? opts.freshAppointment : appt;
  const slot = opts.slot ?? makeSlot();
  const lockAcquired = opts.lockAcquired ?? true;
  const shiftDoc = Object.prototype.hasOwnProperty.call(opts, 'shiftExists')
    ? opts.shiftExists
    : { _id: new Types.ObjectId() };

  const session = {
    withTransaction: jest.fn(async (cb: () => Promise<void>) => cb()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const appointmentModel = {
    db: { startSession: jest.fn().mockResolvedValue(session) },
    findById: jest
      .fn()
      // First call: outside transaction (initial load).
      .mockResolvedValueOnce(appt)
      // Second call: inside transaction (re-fetch for optimistic lock).
      .mockReturnValueOnce({ session: jest.fn().mockResolvedValue(freshAppt) }),
    findOne: jest.fn().mockReturnValue({
      session: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(opts.slotConflict ?? null),
    }),
  };

  const timeSlotLogModel = {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue(slot),
    }),
    updateOne: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
  };

  const shiftModel = {
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(shiftDoc),
    }),
  };

  const visitResult = Object.prototype.hasOwnProperty.call(opts, 'visit') ? opts.visit : makeVisit();
  const visitModel = {
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(visitResult),
    }),
  };

  const encounterModel = {
    exists: jest.fn().mockResolvedValue(opts.encounterExists ?? null),
  };

  const billingModel = {
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(opts.billing ?? null),
    }),
  };

  const paymentModel = {
    exists: jest.fn().mockResolvedValue(opts.paymentExists ?? null),
  };

  const redisService = {
    acquireSlotLock: jest.fn().mockResolvedValue(lockAcquired),
    releaseSlotLock: jest.fn().mockResolvedValue(true),
  };

  const eventEmitter = { emit: jest.fn() };

  const service = new AppointmentRescheduleService(
    eventEmitter as any,
    redisService as any,
    appointmentModel as any,
    timeSlotLogModel as any,
    shiftModel as any,
    visitModel as any,
    encounterModel as any,
    billingModel as any,
    paymentModel as any,
  );

  return { service, eventEmitter, redisService, timeSlotLogModel, shiftModel, appointmentModel, session };
}

// ---- Tests ------------------------------------------------------------------

describe('AppointmentRescheduleService.rescheduleAppointment', () => {
  // --- Success path -----------------------------------------------------------

  it('reschedules when Visit.CREATED — returns SUCCESS and keeps status CONFIRMED', async () => {
    const appt = makeAppointment();
    const { service, eventEmitter, timeSlotLogModel } = createService({ appointment: appt });

    const result = await service.rescheduleAppointment(baseInput);

    expect(result.code).toBe('SUCCESS');
    expect(result.data.appointmentId).toBe(appointmentId);
    expect(result.data.appointmentStatus).toBe(AppointmentStatus.CONFIRMED);
    // Old slot released, new slot booked.
    expect(timeSlotLogModel.updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(oldSlotId) },
      { $set: { status: 'available' } },
      expect.any(Object),
    );
    expect(timeSlotLogModel.updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(newSlotId) },
      { $set: { status: 'booked' } },
      expect.any(Object),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('appointment.rescheduled', expect.objectContaining({
      appointmentId,
      newTimeSlotId: newSlotId,
      oldTimeSlotId: oldSlotId,
    }));
  });

  it('preserves financial fields — they are not present in the update call', async () => {
    const appt = makeAppointment({
      depositAmount: 75000,
      depositPaidAmount: 75000,
      depositStatus: 'PAID',
      consultationFee: 300000,
      coinDiscountAmount: 5000,
      paymentAmount: 220000,
      paymentMethod: 'CASH',
      paymentCategory: 'BHYT',
    });
    const { service } = createService({ appointment: appt });
    const result = await service.rescheduleAppointment(baseInput);

    expect(result.code).toBe('SUCCESS');
    // Financial fields are preserved on the document; the service must not touch them.
    expect(appt.depositAmount).toBe(75000);
    expect(appt.depositPaidAmount).toBe(75000);
    expect(appt.depositStatus).toBe('PAID');
    expect(appt.consultationFee).toBe(300000);
    expect(appt.coinDiscountAmount).toBe(5000);
    expect(appt.paymentAmount).toBe(220000);
    expect(appt.paymentMethod).toBe('CASH');
    expect(appt.paymentCategory).toBe('BHYT');
  });

  it('does NOT set appointmentStatus to RESCHEDULED', async () => {
    const appt = makeAppointment();
    const { service } = createService({ appointment: appt });
    await service.rescheduleAppointment(baseInput);
    // Status must remain CONFIRMED; RESCHEDULED must never be written.
    expect(appt.appointmentStatus).not.toBe(AppointmentStatus.RESCHEDULED);
    expect(appt.appointmentStatus).toBe(AppointmentStatus.CONFIRMED);
  });

  it('does not emit appointment.booking.success', async () => {
    const { service, eventEmitter } = createService({});
    await service.rescheduleAppointment(baseInput);
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('appointment.booking.success', expect.anything());
  });

  it('does not create a new Visit', async () => {
    const { service, eventEmitter } = createService({});
    await service.rescheduleAppointment(baseInput);
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('domain.visit.created', expect.anything());
  });

  it('preserves same appointmentId in the response', async () => {
    const { service } = createService({});
    const result = await service.rescheduleAppointment(baseInput);
    expect(result.data.appointmentId).toBe(appointmentId);
  });

  it('keeps bookingDate unchanged in response', async () => {
    const bookingDate = Date.now() - 24 * 60 * 60 * 1000;
    const { service } = createService({ appointment: makeAppointment({ bookingDate }) });
    const result = await service.rescheduleAppointment(baseInput);
    expect(result.data.bookingDate).toBe(bookingDate);
  });

  // --- Visit lifecycle blocks ------------------------------------------------

  it('blocks with VISIT_ALREADY_STARTED when Visit.CHECKED_IN', async () => {
    const { service } = createService({ visit: makeVisit(VisitStatus.CHECKED_IN) });
    await expect(service.rescheduleAppointment(baseInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'VISIT_ALREADY_STARTED' } },
    } as unknown as BadRequestException);
  });

  it('blocks with VISIT_ALREADY_STARTED when Visit.IN_PROGRESS', async () => {
    const { service } = createService({ visit: makeVisit(VisitStatus.IN_PROGRESS) });
    await expect(service.rescheduleAppointment(baseInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'VISIT_ALREADY_STARTED' } },
    } as unknown as BadRequestException);
  });

  it('blocks with VISIT_COMPLETED when Visit.COMPLETED', async () => {
    const { service } = createService({ visit: makeVisit(VisitStatus.COMPLETED) });
    await expect(service.rescheduleAppointment(baseInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'VISIT_COMPLETED' } },
    } as unknown as BadRequestException);
  });

  it('blocks with VISIT_COMPLETED when Visit.CANCELLED', async () => {
    const { service } = createService({ visit: makeVisit(VisitStatus.CANCELLED) });
    await expect(service.rescheduleAppointment(baseInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'VISIT_COMPLETED' } },
    } as unknown as BadRequestException);
  });

  it('blocks with APPOINTMENT_NOT_RESCHEDULABLE when no visit exists', async () => {
    const { service } = createService({ visit: null });
    await expect(service.rescheduleAppointment(baseInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'APPOINTMENT_NOT_RESCHEDULABLE' } },
    } as unknown as BadRequestException);
  });

  // --- Clinical/financial blocks --------------------------------------------

  it('blocks with MEDICAL_ENCOUNTER_EXISTS when encounter exists', async () => {
    const { service } = createService({ encounterExists: { _id: 'enc-1' } });
    await expect(service.rescheduleAppointment(baseInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'MEDICAL_ENCOUNTER_EXISTS' } },
    } as unknown as BadRequestException);
  });

  it('blocks with BILLING_EXISTS when billing exists (no payment)', async () => {
    const { service } = createService({
      billing: { _id: new Types.ObjectId() },
      paymentExists: null,
    });
    await expect(service.rescheduleAppointment(baseInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'BILLING_EXISTS' } },
    } as unknown as BadRequestException);
  });

  it('blocks with PAYMENT_EXISTS when billing AND payment both exist', async () => {
    const { service } = createService({
      billing: { _id: new Types.ObjectId() },
      paymentExists: { _id: 'pay-1' },
    });
    await expect(service.rescheduleAppointment(baseInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'PAYMENT_EXISTS' } },
    } as unknown as BadRequestException);
  });

  // --- Appointment status blocks -------------------------------------------

  it('blocks with APPOINTMENT_NOT_RESCHEDULABLE when status is CANCELLED', async () => {
    const { service } = createService({
      appointment: makeAppointment({ appointmentStatus: AppointmentStatus.CANCELLED }),
    });
    await expect(service.rescheduleAppointment(baseInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'APPOINTMENT_NOT_RESCHEDULABLE' } },
    } as unknown as BadRequestException);
  });

  it('blocks with APPOINTMENT_NOT_RESCHEDULABLE when status is COMPLETED', async () => {
    const { service } = createService({
      appointment: makeAppointment({ appointmentStatus: AppointmentStatus.COMPLETED }),
    });
    await expect(service.rescheduleAppointment(baseInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'APPOINTMENT_NOT_RESCHEDULABLE' } },
    } as unknown as BadRequestException);
  });

  // --- Schedule/slot blocks ------------------------------------------------

  it('blocks with INVALID_SCHEDULE when new scheduledAt is in the past', async () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('Z', '+00:00');
    const { service } = createService({});
    await expect(service.rescheduleAppointment({ ...baseInput, appointmentDate: pastDate }))
      .rejects.toMatchObject({
        response: { data: { blockedReason: 'INVALID_SCHEDULE' } },
      } as unknown as BadRequestException);
  });

  it('returns SLOT_UNAVAILABLE when Redis lock cannot be acquired', async () => {
    const { service } = createService({ lockAcquired: false });
    const result = await service.rescheduleAppointment(baseInput);
    expect(result.code).toBe('ERROR');
    expect(result.data.blockedReason).toBe('SLOT_UNAVAILABLE');
  });

  it('returns SLOT_UNAVAILABLE when slot conflict found inside transaction', async () => {
    const { service } = createService({
      slotConflict: { _id: new Types.ObjectId() },
    });
    const result = await service.rescheduleAppointment(baseInput);
    expect(result.code).toBe('ERROR');
    expect(result.data.blockedReason).toBe('SLOT_UNAVAILABLE');
  });

  it('returns SLOT_UNAVAILABLE on duplicate key error (code 11000)', async () => {
    const appt = makeAppointment();
    // Make the transaction throw a Mongo duplicate key error.
    const session = {
      withTransaction: jest.fn().mockRejectedValue({ code: 11000 }),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const appointmentModel = {
      db: { startSession: jest.fn().mockResolvedValue(session) },
      findById: jest.fn().mockResolvedValueOnce(appt),
    };
    const visitModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(makeVisit()),
      }),
    };
    const timeSlotLogModel = {
      findById: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(makeSlot()) }),
      updateOne: jest.fn(),
    };
    const shiftModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      }),
    };
    const service = new AppointmentRescheduleService(
      { emit: jest.fn() } as any,
      { acquireSlotLock: jest.fn().mockResolvedValue(true), releaseSlotLock: jest.fn() } as any,
      appointmentModel as any,
      timeSlotLogModel as any,
      shiftModel as any,
      visitModel as any,
      { exists: jest.fn().mockResolvedValue(null) } as any,
      { findOne: jest.fn().mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) }) } as any,
      { exists: jest.fn().mockResolvedValue(null) } as any,
    );
    const result = await service.rescheduleAppointment(baseInput);
    expect(result.code).toBe('ERROR');
    expect(result.data.blockedReason).toBe('SLOT_UNAVAILABLE');
  });

  // --- Slot state consistency -----------------------------------------------

  it('does not release old slot when slot has not changed (same slot same schedule would be no-op, but testing same-slot different-date path)', async () => {
    // If the new timeSlotId equals the old timeSlotId, old slot must not be released.
    const sameSlotInput: RescheduleInput = { ...baseInput, timeSlotId: oldSlotId };
    const appt = makeAppointment({ timeSlot: new Types.ObjectId(oldSlotId) });
    const { service, timeSlotLogModel } = createService({
      appointment: appt,
      slot: { _id: new Types.ObjectId(oldSlotId), start: '09:00', end: '09:30' },
    });
    await service.rescheduleAppointment(sameSlotInput);
    // updateOne for "available" (slot release) must NOT have been called with the old slot.
    const releaseCalls = (timeSlotLogModel.updateOne as jest.Mock).mock.calls.filter(
      (args: any[]) => args[1]?.$set?.status === 'available',
    );
    expect(releaseCalls).toHaveLength(0);
  });

  it('releases Redis lock in finally block even when transaction fails', async () => {
    const { service, redisService } = createService({
      visit: makeVisit(VisitStatus.CHECKED_IN),
    });
    // Reschedule will be blocked before reaching the lock, but let's test the lock-path failure.
    // Use a setup where lock is acquired and transaction throws.
    const appt = makeAppointment();
    const session = {
      withTransaction: jest.fn().mockRejectedValue(new Error('DB error')),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const appointmentModel = {
      db: { startSession: jest.fn().mockResolvedValue(session) },
      findById: jest.fn().mockResolvedValueOnce(appt),
    };
    const visitModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(makeVisit()),
      }),
    };
    const timeSlotLogModel = {
      findById: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(makeSlot()) }),
      updateOne: jest.fn(),
    };
    const rs = { acquireSlotLock: jest.fn().mockResolvedValue(true), releaseSlotLock: jest.fn().mockResolvedValue(true) };
    const inlineShiftModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      }),
    };
    const svc = new AppointmentRescheduleService(
      { emit: jest.fn() } as any,
      rs as any,
      appointmentModel as any,
      timeSlotLogModel as any,
      inlineShiftModel as any,
      visitModel as any,
      { exists: jest.fn().mockResolvedValue(null) } as any,
      { findOne: jest.fn().mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) }) } as any,
      { exists: jest.fn().mockResolvedValue(null) } as any,
    );
    await expect(svc.rescheduleAppointment(baseInput)).rejects.toThrow('DB error');
    expect(rs.releaseSlotLock).toHaveBeenCalled();
  });

  // --- Not-found guards -------------------------------------------------------

  it('throws NotFoundException when appointment does not exist', async () => {
    const { service } = createService({ appointment: null });
    // findById returns null
    await expect(service.rescheduleAppointment(baseInput)).rejects.toBeInstanceOf(NotFoundException);
  });

  // --- Doctor / slot ownership validation ------------------------------------

  it('blocks with APPOINTMENT_DOCTOR_NOT_ASSIGNED when appointment has no doctorId', async () => {
    const { service } = createService({
      appointment: makeAppointment({ doctorId: null }),
    });
    await expect(service.rescheduleAppointment(baseInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'APPOINTMENT_DOCTOR_NOT_ASSIGNED' } },
    } as unknown as BadRequestException);
  });

  it('blocks with SLOT_DOCTOR_MISMATCH when slot belongs to a different doctor', async () => {
    const { service } = createService({ shiftExists: null });
    await expect(service.rescheduleAppointment(baseInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'SLOT_DOCTOR_MISMATCH' } },
    } as unknown as BadRequestException);
  });

  it('succeeds when slot belongs to the same doctor', async () => {
    const { service } = createService({ shiftExists: { _id: new Types.ObjectId() } });
    const result = await service.rescheduleAppointment(baseInput);
    expect(result.code).toBe('SUCCESS');
  });
});
