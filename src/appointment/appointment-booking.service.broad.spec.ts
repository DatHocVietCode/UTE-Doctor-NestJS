jest.mock('src/patient/schema/medical-record.schema', () => ({
  MedicalEncounter: class MedicalEncounter {},
}));
jest.mock('src/payment/payment.service', () => ({ PaymentService: class PaymentService {} }));
jest.mock('./schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('./schemas/appointment-assignment-task.schema', () => ({
  AppointmentAssignmentTask: class AppointmentAssignmentTask {},
}));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({ TimeSlotLog: class TimeSlotLog {} }));
jest.mock('src/patient/schema/patient.schema', () => ({ Patient: class Patient {} }));
jest.mock('src/doctor/schema/doctor.schema', () => ({ Doctor: class Doctor {} }));
jest.mock('src/payment/schemas/payment.schema', () => ({ Payment: class Payment {} }));

import { Types } from 'mongoose';
import { PaymentMethodEnum } from 'src/payment/enums/payment-method.enum';
import { AppointmentBookingService } from './appointment-booking.service';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { AssignmentStatus } from './enums/assignment-status.enum';
import { AssignmentTaskStatus } from './enums/assignment-task-status.enum';
import { DepositStatus } from './enums/deposit-status.enum';
import { PaymentCategory } from './enums/payment-category.enum';
import { ServiceType } from './enums/service-type.enum';
import { VisitType } from './enums/visit-type.enum';

const patientId = new Types.ObjectId('64b000000000000000000201');
const newAppointmentId = new Types.ObjectId('64b000000000000000000202');
const newTaskId = new Types.ObjectId('64b000000000000000000203');

function queryResult<T>(value: T) {
  return {
    exec: jest.fn().mockResolvedValue(value),
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
  };
}

function createExpiredBroadAppointment(overrides: Record<string, any> = {}) {
  return {
    _id: newAppointmentId,
    appointmentStatus: AppointmentStatus.PENDING,
    assignmentStatus: AssignmentStatus.AWAITING_ASSIGNMENT,
    paymentCategory: PaymentCategory.DICH_VU,
    depositStatus: DepositStatus.PENDING,
    patientEmail: 'patient@example.com',
    doctorId: undefined,
    timeSlot: undefined,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createService(opts: {
  depositThrows?: boolean;
  expiredNormalAppointments?: any[];
  expiredBroadAppointments?: any[];
  findByIdAppointment?: any;
  expiredBroadAppointment?: any;
  legacyActiveTask?: any;
  depositPayment?: any;
} = {}) {
  const session = {
    withTransaction: jest.fn(async (cb: () => Promise<void>) => cb()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  let savedAppointment: any = null;
  const findByIdAppointment =
    opts.findByIdAppointment ?? opts.expiredBroadAppointment ?? opts.expiredBroadAppointments?.[0] ?? null;
  const appointmentModel = {
    db: { startSession: jest.fn().mockResolvedValue(session) },
    create: jest.fn(async (docs: any[]) => {
      savedAppointment = { ...docs[0], _id: docs[0]._id ?? newAppointmentId };
      return [savedAppointment];
    }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    findById: jest.fn().mockImplementation(() => {
      const query = Promise.resolve(findByIdAppointment) as Promise<any> & {
        session: jest.Mock;
      };
      query.session = jest.fn().mockResolvedValue(findByIdAppointment);
      return query;
    }),
    findOne: jest.fn(),
    find: jest
      .fn()
      .mockReturnValueOnce(queryResult(opts.expiredNormalAppointments ?? []))
      .mockReturnValueOnce(queryResult(opts.expiredBroadAppointments ?? [])),
  };

  const assignmentFindOneResult = {
    select: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(opts.legacyActiveTask ?? null),
  };
  const assignmentTaskModel = {
    create: jest.fn(async (docs: any[]) => [{ ...docs[0], _id: newTaskId }]),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    findOne: jest.fn().mockReturnValue(assignmentFindOneResult),
  };

  const eventEmitter = { emit: jest.fn() };
  const redisService = {
    acquireSlotLock: jest.fn(),
    releaseSlotLock: jest.fn().mockResolvedValue(undefined),
  };
  const timeSlotLogModel = {
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
  };
  const paymentModel = {
    findOne: jest.fn().mockReturnValue({
      session: jest.fn().mockResolvedValue(opts.depositPayment ?? {
        status: 'PENDING',
        expireAt: new Date(),
        save: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  };
  const paymentService = {
    createDepositPaymentForAppointment: opts.depositThrows
      ? jest.fn().mockRejectedValue(new Error('deposit gateway down'))
      : jest.fn().mockResolvedValue({
          paymentId: '64b000000000000000000205',
          paymentUrl: 'https://vnpay.example/pay',
          amount: 50000,
          purpose: 'APPOINTMENT_DEPOSIT',
        }),
  };

  const service = new AppointmentBookingService(
    eventEmitter as any,
    { get: jest.fn((key: string) => (key === 'CONSULTATION_FEE' ? '150000' : undefined)) } as any,
    paymentService as any,
    redisService as any,
    {} as any,
    {} as any,
    appointmentModel as any,
    timeSlotLogModel as any,
    {} as any,
    {} as any,
    paymentModel as any,
    assignmentTaskModel as any,
  );

  return {
    service,
    appointmentModel,
    assignmentTaskModel,
    paymentService,
    eventEmitter,
    session,
    redisService,
    timeSlotLogModel,
    paymentModel,
    getSaved: () => savedAppointment,
  };
}

function broadPayload(overrides: Record<string, any> = {}) {
  return {
    broadBooking: true,
    specialty: 'cardiology',
    reasonForAppointment: 'chest pain',
    serviceType: ServiceType.KHAM_BHYT,
    paymentMethod: PaymentMethodEnum.VNPAY,
    visitType: VisitType.OFFLINE,
    paymentCategory: PaymentCategory.BHYT,
    patientEmail: 'patient@example.com',
    patientId: patientId.toString(),
    ...overrides,
  };
}

describe('AppointmentBookingService broad booking', () => {
  it('creates a PENDING appointment without doctor/slot and AWAITING_ASSIGNMENT', async () => {
    const { service, getSaved } = createService();

    const result = await service.bookAppointment(broadPayload() as any, '127.0.0.1');

    const saved = getSaved();
    expect(saved.doctorId).toBeUndefined();
    expect(saved.timeSlot).toBeUndefined();
    expect(saved.appointmentStatus).toBe(AppointmentStatus.PENDING);
    expect(saved.assignmentStatus).toBe(AssignmentStatus.AWAITING_ASSIGNMENT);
    expect(result.data.assignmentStatus).toBe(AssignmentStatus.AWAITING_ASSIGNMENT);
    expect(result.data.appointmentId).toBe(saved._id.toString());
    expect(result.data.assignmentTaskId).toBe(newTaskId.toString());
  });

  it('creates exactly one PENDING assignment task with routing fields', async () => {
    const { service, assignmentTaskModel } = createService();

    await service.bookAppointment(broadPayload() as any, '127.0.0.1');

    expect(assignmentTaskModel.create).toHaveBeenCalledTimes(1);
    const [docs] = assignmentTaskModel.create.mock.calls[0];
    expect(docs[0]).toMatchObject({
      status: AssignmentTaskStatus.PENDING,
      specialty: 'cardiology',
      reasonForAppointment: 'chest pain',
      patientEmail: 'patient@example.com',
      priority: 'NORMAL',
    });
    expect(typeof docs[0].deadlineAt).toBe('number');
    expect(docs[0].deadlineAt).toBeGreaterThan(Date.now());
  });

  it('does not emit appointment.booking.success and does not create a Visit', async () => {
    const { service, eventEmitter } = createService();

    await service.bookAppointment(broadPayload() as any, '127.0.0.1');

    expect(eventEmitter.emit).not.toHaveBeenCalledWith('appointment.booking.success', expect.anything());
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('domain.visit.created', expect.anything());
    // Routing event is emitted instead.
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'appointment.assignment.created',
      expect.objectContaining({
        taskId: newTaskId.toString(),
        specialty: 'cardiology',
        priority: 'NORMAL',
        reasonForAppointment: 'chest pain',
      }),
    );
  });

  it('BHYT broad booking is NOT_REQUIRED with no deposit payment', async () => {
    const { service, paymentService, getSaved } = createService();

    const result = await service.bookAppointment(broadPayload() as any, '127.0.0.1');

    expect(getSaved().depositStatus).toBe(DepositStatus.NOT_REQUIRED);
    expect(result.data.depositStatus).toBe(DepositStatus.NOT_REQUIRED);
    expect(result.data.paymentUrl).toBeUndefined();
    expect(paymentService.createDepositPaymentForAppointment).not.toHaveBeenCalled();
  });

  it('DICH_VU broad booking takes a deposit before creating an assignment task', async () => {
    const { service, paymentService, assignmentTaskModel, eventEmitter, getSaved } = createService();

    const result = await service.bookAppointment(
      broadPayload({
        serviceType: ServiceType.KHAM_DICH_VU,
        paymentCategory: PaymentCategory.DICH_VU,
        depositAmount: 50000,
      }) as any,
      '127.0.0.1',
    );

    expect(getSaved().depositStatus).toBe(DepositStatus.PENDING);
    expect(result.code).toBe('PENDING');
    expect(result.data.depositStatus).toBe(DepositStatus.PENDING);
    expect(result.data.paymentUrl).toBe('https://vnpay.example/pay');
    expect(result.data.assignmentTaskId).toBeUndefined();
    expect(assignmentTaskModel.create).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('appointment.assignment.created', expect.anything());
    expect(paymentService.createDepositPaymentForAppointment).toHaveBeenCalledWith(
      getSaved()._id.toString(),
      50000,
      '127.0.0.1',
    );
  });

  it('rejects DICH_VU broad booking without a positive depositAmount', async () => {
    const { service } = createService();
    await expect(
      service.bookAppointment(
        broadPayload({ paymentCategory: PaymentCategory.DICH_VU, depositAmount: 0 }) as any,
      ),
    ).rejects.toThrow('depositAmount must be greater than 0 for DICH_VU bookings');
  });

  it('blocks broad booking when neither specialty nor reason is provided', async () => {
    const { service } = createService();
    await expect(
      service.bookAppointment(
        broadPayload({ specialty: undefined, reasonForAppointment: undefined }) as any,
      ),
    ).rejects.toThrow('Either specialty or reasonForAppointment is required for broad booking');
  });

  it('marks appointment FAILED without touching assignment tasks if DICH_VU deposit creation fails', async () => {
    const { service, appointmentModel, assignmentTaskModel, eventEmitter, getSaved } = createService({ depositThrows: true });

    const result = await service.bookAppointment(
      broadPayload({
        serviceType: ServiceType.KHAM_DICH_VU,
        paymentCategory: PaymentCategory.DICH_VU,
        depositAmount: 50000,
      }) as any,
      '127.0.0.1',
    );

    expect(result.code).toBe('ERROR');
    const apptUpdate = appointmentModel.updateOne.mock.calls[0];
    expect(apptUpdate[0]._id.toString()).toBe(getSaved()._id.toString());
    expect(apptUpdate[1]).toEqual({
      $set: { appointmentStatus: AppointmentStatus.FAILED, depositStatus: DepositStatus.FAILED },
    });
    expect(assignmentTaskModel.create).not.toHaveBeenCalled();
    expect(assignmentTaskModel.updateOne).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('appointment.assignment.created', expect.anything());
  });

  it('broad DICH_VU unpaid timeout fails appointment/deposit without slot release or timeout semantics', async () => {
    const expiredBroad = createExpiredBroadAppointment();
    const depositPayment = {
      status: 'PENDING',
      expireAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const { service, eventEmitter, assignmentTaskModel } = createService({
      expiredBroadAppointments: [expiredBroad],
      expiredBroadAppointment: expiredBroad,
      depositPayment,
    });

    await service.expirePendingBookings();

    expect(expiredBroad.appointmentStatus).toBe(AppointmentStatus.FAILED);
    expect(expiredBroad.depositStatus).toBe(DepositStatus.FAILED);
    expect(depositPayment.status).toBe('FAILED');
    expect(depositPayment.expireAt).toBeNull();
    expect(assignmentTaskModel.updateOne).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'appointment.booking.failed',
      expect.objectContaining({ appointmentId: expiredBroad._id.toString() }),
    );
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('appointment.assignment.expired', expect.anything());
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('notify.patient.appointment.cancelled', expect.anything());
  });

  it('legacy broad DICH_VU unpaid timeout closes an active pre-created task as CANCELLED', async () => {
    const expiredBroad = createExpiredBroadAppointment();
    const legacyTask = { _id: newTaskId, status: AssignmentTaskStatus.PENDING };
    const { service, assignmentTaskModel } = createService({
      expiredBroadAppointments: [expiredBroad],
      expiredBroadAppointment: expiredBroad,
      legacyActiveTask: legacyTask,
    });

    await service.expirePendingBookings();

    expect(assignmentTaskModel.updateOne).toHaveBeenCalledWith(
      {
        _id: legacyTask._id,
        status: { $in: [AssignmentTaskStatus.PENDING, AssignmentTaskStatus.ASSIGNED] },
      },
      expect.objectContaining({
        $set: { status: AssignmentTaskStatus.CANCELLED },
        $push: expect.objectContaining({
          history: expect.objectContaining({
            to: AssignmentTaskStatus.CANCELLED,
            note: 'deposit payment expired',
          }),
        }),
      }),
      expect.any(Object),
    );
  });

  it('normal doctor-selected DICH_VU unpaid timeout still releases Redis lock and TimeSlotLog', async () => {
    const normalAppointment = {
      _id: newAppointmentId,
      appointmentStatus: AppointmentStatus.PENDING,
      assignmentStatus: AssignmentStatus.NONE,
      paymentCategory: PaymentCategory.DICH_VU,
      depositStatus: DepositStatus.PENDING,
      patientEmail: 'patient@example.com',
      doctorId: { toString: () => '64b000000000000000000301' },
      timeSlot: { toString: () => '64b000000000000000000302' },
      consultationFee: 150000,
      paymentAmount: 150000,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const { service, redisService, timeSlotLogModel, assignmentTaskModel } = createService({
      expiredNormalAppointments: [normalAppointment],
      findByIdAppointment: normalAppointment,
    });

    await service.expirePendingBookings();

    expect(normalAppointment.appointmentStatus).toBe(AppointmentStatus.FAILED);
    expect(normalAppointment.depositStatus).toBe(DepositStatus.FAILED);
    expect(redisService.releaseSlotLock).toHaveBeenCalledWith(
      'slot:64b000000000000000000301:64b000000000000000000302',
      normalAppointment._id.toString(),
    );
    const [slotFilter, slotUpdate] = timeSlotLogModel.updateOne.mock.calls[0];
    expect(slotFilter._id.toString()).toBe(normalAppointment.timeSlot.toString());
    expect(slotUpdate).toEqual({ $set: { status: 'available' } });
    expect(assignmentTaskModel.updateOne).not.toHaveBeenCalled();
  });
});

// Contrast: the NORMAL (non-broad) path must still hard-require doctor + timeSlot, so
// broad booking's relaxed validation cannot leak into ordinary doctor-selected bookings.
describe('AppointmentBookingService normal booking validation (regression guard)', () => {
  function normalPayload(overrides: Record<string, any> = {}) {
    return {
      // broadBooking intentionally omitted -> normal path
      doctor: { id: '64b000000000000000000299' },
      timeSlotId: '64b000000000000000000298',
      appointmentDate: '2026-06-01T08:00:00+07:00',
      hospitalName: 'UTE Hospital',
      serviceType: ServiceType.KHAM_BHYT,
      paymentMethod: PaymentMethodEnum.VNPAY,
      paymentCategory: PaymentCategory.BHYT,
      patientEmail: 'patient@example.com',
      patientId: patientId.toString(),
      ...overrides,
    };
  }

  it('still rejects a normal booking with no doctor', async () => {
    const { service } = createService();
    await expect(
      service.bookAppointment(normalPayload({ doctor: undefined }) as any, '127.0.0.1'),
    ).rejects.toThrow('Doctor is required');
  });

  it('still rejects a normal booking with no time slot', async () => {
    const { service } = createService();
    await expect(
      service.bookAppointment(normalPayload({ timeSlotId: undefined }) as any, '127.0.0.1'),
    ).rejects.toThrow('Time slot is required');
  });
});
