// Mock every schema the service imports (ts-jest isolatedModules strips @Prop metadata).
jest.mock('./schemas/appointment-assignment-task.schema', () => ({
  AppointmentAssignmentTask: class AppointmentAssignmentTask {},
}));
jest.mock('./schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('./schemas/appointment-enriched', () => ({
  buildEnrichedAppointmentPayload: jest.fn(() => ({ appointmentId: 'enriched' })),
}));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({ TimeSlotLog: class TimeSlotLog {} }));
jest.mock('src/shift/schema/shift.schema', () => ({ Shift: class Shift {} }));
jest.mock('src/doctor/schema/doctor.schema', () => ({ Doctor: class Doctor {} }));
jest.mock('src/patient/schema/patient.schema', () => ({ Patient: class Patient {} }));

import { Types } from 'mongoose';
import { AppointmentAssignmentTaskService } from './appointment-assignment-task.service';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { AssignmentStatus } from './enums/assignment-status.enum';
import { AssignmentTaskStatus } from './enums/assignment-task-status.enum';
import { DepositStatus } from './enums/deposit-status.enum';
import { PaymentCategory } from './enums/payment-category.enum';

const taskId = '64d000000000000000000001';
const appointmentId = '64d000000000000000000002';
const receptionistId = '64d000000000000000000003';
const doctorId = '64d000000000000000000004';
const timeSlotId = '64d000000000000000000005';
const patientId = '64d000000000000000000006';

const futureDate = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString().replace('Z', '+00:00');
const assignInput = { doctorId, timeSlotId, appointmentDate: futureDate };

function makeTaskLean(overrides: Record<string, any> = {}) {
  return {
    status: AssignmentTaskStatus.ASSIGNED,
    acceptedByReceptionistId: { toString: () => receptionistId },
    appointmentId,
    ...overrides,
  };
}

function makeAppointment(overrides: Record<string, any> = {}) {
  return {
    _id: { toString: () => appointmentId },
    appointmentStatus: AppointmentStatus.PENDING,
    assignmentStatus: AssignmentStatus.AWAITING_ASSIGNMENT,
    doctorId: undefined,
    timeSlot: undefined,
    paymentCategory: PaymentCategory.BHYT,
    depositStatus: DepositStatus.NOT_REQUIRED,
    patientId,
    patientEmail: 'patient@example.com',
    consultationFee: 150000,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeFreshTask(overrides: Record<string, any> = {}) {
  return {
    status: AssignmentTaskStatus.ASSIGNED,
    acceptedByReceptionistId: { toString: () => receptionistId },
    history: [] as any[],
    completedAt: undefined,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createService(opts: {
  taskLean?: any;
  appointment?: any;
  freshAppt?: any;
  freshTask?: any;
  slot?: any;
  shiftOwner?: any;
  lockAcquired?: boolean;
  taskLockAcquired?: boolean;
  conflict?: any;
} = {}) {
  const taskLean = opts.taskLean === null ? null : opts.taskLean ?? makeTaskLean();
  const appointment = opts.appointment === null ? null : opts.appointment ?? makeAppointment();
  const freshAppt = opts.freshAppt ?? appointment;
  const freshTask = opts.freshTask ?? makeFreshTask();
  const slot = opts.slot === null ? null : opts.slot ?? { start: '09:00', end: '09:30', status: 'available' };
  const shiftOwner = opts.shiftOwner === null ? null : opts.shiftOwner ?? { _id: new Types.ObjectId() };
  const lockAcquired = opts.lockAcquired ?? true;

  const session = {
    withTransaction: jest.fn(async (cb: () => Promise<void>) => cb()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const taskModel = {
    findById: jest
      .fn()
      // initial load: .select().lean()
      .mockReturnValueOnce({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(taskLean) }) })
      // in-tx: .session()
      .mockReturnValueOnce({ session: jest.fn().mockResolvedValue(freshTask) }),
  };

  const appointmentModel = {
    db: { startSession: jest.fn().mockResolvedValue(session) },
    findById: jest
      .fn()
      // initial load (no session)
      .mockResolvedValueOnce(appointment)
      // in-tx load
      .mockReturnValueOnce({ session: jest.fn().mockResolvedValue(freshAppt) }),
    findOne: jest.fn().mockReturnValue({
      session: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(opts.conflict ?? null),
    }),
  };

  const timeSlotLogModel = {
    findById: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(slot) }) }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };

  const shiftModel = {
    findOne: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(shiftOwner) }) }),
  };

  const doctorModel = {
    findById: jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ profileId: { name: 'Dr. A', email: 'dr@x.com' } }) }),
    }),
  };
  const patientModel = {
    findById: jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ profileId: { name: 'Pat', email: 'patient@example.com' } }) }),
    }),
  };

  const redisService = {
    acquireSlotLock: jest.fn().mockResolvedValue(lockAcquired),
    releaseSlotLock: jest.fn().mockResolvedValue(true),
    acquireLock: jest.fn().mockResolvedValue(opts.taskLockAcquired ?? true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  };
  const eventEmitter = { emit: jest.fn() };

  const service = new AppointmentAssignmentTaskService(
    taskModel as any,
    appointmentModel as any,
    timeSlotLogModel as any,
    shiftModel as any,
    doctorModel as any,
    patientModel as any,
    redisService as any,
    eventEmitter as any,
  );

  return { service, eventEmitter, redisService, timeSlotLogModel, freshTask, appointment, freshAppt };
}

describe('AppointmentAssignmentTaskService.assignDoctorAndSlot', () => {
  it('assigns doctor/slot, books slot, completes task, emits booking.success + assignment.completed', async () => {
    const { service, eventEmitter, timeSlotLogModel, freshTask, freshAppt } = createService();

    const result = await service.assignDoctorAndSlot(taskId, receptionistId, assignInput);

    expect(result.code).toBe('SUCCESS');
    // Appointment gained doctor/slot and ASSIGNED routing state.
    expect(freshAppt.doctorId.toString()).toBe(doctorId);
    expect(freshAppt.timeSlot.toString()).toBe(timeSlotId);
    expect(freshAppt.assignmentStatus).toBe(AssignmentStatus.ASSIGNED);
    expect(freshAppt.save).toHaveBeenCalled();
    // Slot booked.
    expect(timeSlotLogModel.updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(timeSlotId) },
      { $set: { status: 'booked' } },
      expect.any(Object),
    );
    // Task completed.
    expect(freshTask.status).toBe(AssignmentTaskStatus.COMPLETED);
    expect(typeof freshTask.completedAt).toBe('number');
    expect(freshTask.save).toHaveBeenCalled();
    // Events.
    expect(eventEmitter.emit).toHaveBeenCalledWith('appointment.booking.success', expect.any(Object));
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'appointment.assignment.completed',
      expect.objectContaining({ taskId, appointmentId, doctorId, timeSlotId }),
    );
  });

  it('does not create a Visit directly (relies on booking.success listener)', async () => {
    const { service, eventEmitter } = createService();
    await service.assignDoctorAndSlot(taskId, receptionistId, assignInput);
    // The service must not emit a direct visit-creation event; Visit is created by the
    // existing VisitBookingListener reacting to appointment.booking.success.
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('domain.visit.created', expect.anything());
    const successCalls = (eventEmitter.emit as jest.Mock).mock.calls.filter((c) => c[0] === 'appointment.booking.success');
    expect(successCalls).toHaveLength(1);
  });

  it('blocks a non-owner with TASK_NOT_OWNED', async () => {
    const { service } = createService({
      taskLean: makeTaskLean({ acceptedByReceptionistId: { toString: () => 'someone-else' } }),
    });
    await expect(service.assignDoctorAndSlot(taskId, receptionistId, assignInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'TASK_NOT_OWNED' } },
    });
  });

  it('blocks a not-yet-accepted (PENDING) task with TASK_NOT_ASSIGNED', async () => {
    const { service } = createService({ taskLean: makeTaskLean({ status: AssignmentTaskStatus.PENDING }) });
    await expect(service.assignDoctorAndSlot(taskId, receptionistId, assignInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'TASK_NOT_ASSIGNED' } },
    });
  });

  it('blocks when the appointment is no longer assignable (cancelled)', async () => {
    const { service } = createService({
      appointment: makeAppointment({ appointmentStatus: AppointmentStatus.CANCELLED }),
    });
    await expect(service.assignDoctorAndSlot(taskId, receptionistId, assignInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'APPOINTMENT_NOT_ASSIGNABLE' } },
    });
  });

  it('blocks when the slot does not belong to the doctor (SLOT_DOCTOR_MISMATCH)', async () => {
    const { service } = createService({ shiftOwner: null });
    await expect(service.assignDoctorAndSlot(taskId, receptionistId, assignInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'SLOT_DOCTOR_MISMATCH' } },
    });
  });

  it('blocks with SLOT_UNAVAILABLE when the slot lock cannot be acquired', async () => {
    const { service } = createService({ lockAcquired: false });
    await expect(service.assignDoctorAndSlot(taskId, receptionistId, assignInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'SLOT_UNAVAILABLE' } },
    });
  });

  it('blocks with SLOT_UNAVAILABLE when another appointment already holds the slot', async () => {
    const { service, redisService } = createService({ conflict: { _id: new Types.ObjectId() } });
    await expect(service.assignDoctorAndSlot(taskId, receptionistId, assignInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'SLOT_UNAVAILABLE' } },
    });
    // Lock is always released.
    expect(redisService.releaseSlotLock).toHaveBeenCalled();
  });

  it('blocks DICH_VU assignment when the deposit is not yet PAID', async () => {
    const { service } = createService({
      appointment: makeAppointment({
        paymentCategory: PaymentCategory.DICH_VU,
        depositStatus: DepositStatus.PENDING,
      }),
    });
    await expect(service.assignDoctorAndSlot(taskId, receptionistId, assignInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'DEPOSIT_NOT_PAID' } },
    });
  });

  it('allows DICH_VU assignment once the deposit is PAID', async () => {
    const paid = makeAppointment({ paymentCategory: PaymentCategory.DICH_VU, depositStatus: DepositStatus.PAID });
    const { service } = createService({ appointment: paid, freshAppt: paid });
    const result = await service.assignDoctorAndSlot(taskId, receptionistId, assignInput);
    expect(result.code).toBe('SUCCESS');
  });

  it('throws TASK_NOT_FOUND for a missing task', async () => {
    const { service } = createService({ taskLean: null });
    await expect(service.assignDoctorAndSlot(taskId, receptionistId, assignInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'TASK_NOT_FOUND' } },
    });
  });

  it('blocks with TASK_LOCK_HELD when another receptionist holds the task lock', async () => {
    const { service, redisService } = createService({ taskLockAcquired: false });

    await expect(service.assignDoctorAndSlot(taskId, receptionistId, assignInput)).rejects.toMatchObject({
      response: { data: { blockedReason: 'TASK_LOCK_HELD' } },
    });
    // Did not proceed to the slot lock, and never released a lock it did not own.
    expect(redisService.acquireSlotLock).not.toHaveBeenCalled();
    expect(redisService.releaseLock).not.toHaveBeenCalled();
  });

  it('acquires and releases the task lock around a successful assignment', async () => {
    const { service, redisService } = createService();

    await service.assignDoctorAndSlot(taskId, receptionistId, assignInput);

    const taskLockKey = `assignment-task:${taskId}:lock`;
    const taskLockValue = `receptionist:${receptionistId}`;
    expect(redisService.acquireLock).toHaveBeenCalledWith(taskLockKey, taskLockValue, expect.any(Number));
    expect(redisService.releaseLock).toHaveBeenCalledWith(taskLockKey, taskLockValue);
  });
});
