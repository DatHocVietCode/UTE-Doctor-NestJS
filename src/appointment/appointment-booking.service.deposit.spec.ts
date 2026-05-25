jest.mock('src/patient/schema/medical-record.schema', () => ({
  MedicalEncounter: class MedicalEncounter {},
}));
jest.mock('src/payment/payment.service', () => ({ PaymentService: class PaymentService {} }));
jest.mock('./schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({ TimeSlotLog: class TimeSlotLog {} }));
jest.mock('src/patient/schema/patient.schema', () => ({ Patient: class Patient {} }));
jest.mock('src/doctor/schema/doctor.schema', () => ({ Doctor: class Doctor {} }));
jest.mock('src/payment/schemas/payment.schema', () => ({ Payment: class Payment {} }));

import { Types } from 'mongoose';
import { AppointmentBookingService } from './appointment-booking.service';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { DepositStatus } from './enums/deposit-status.enum';
import { PaymentCategory } from './enums/payment-category.enum';
import { ServiceType } from './enums/service-type.enum';
import { VisitType } from './enums/visit-type.enum';
import { PaymentMethodEnum } from 'src/payment/enums/payment-method.enum';

const appointmentId = new Types.ObjectId('64b000000000000000000101');
const doctorId = new Types.ObjectId('64b000000000000000000102');
const patientId = new Types.ObjectId('64b000000000000000000103');
const timeSlotId = new Types.ObjectId('64b000000000000000000104');

function queryResult<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function createService() {
  const session = {
    withTransaction: jest.fn(async (callback: () => Promise<void>) => callback()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  let savedAppointment: any = null;

  const appointmentModel = {
    db: { startSession: jest.fn().mockResolvedValue(session) },
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    }),
    create: jest.fn(async (docs: any[]) => {
      savedAppointment = {
        ...docs[0],
        _id: docs[0]._id ?? appointmentId,
        save: jest.fn().mockResolvedValue(undefined),
      };
      savedAppointment.toObject = jest.fn(() => savedAppointment);
      return [savedAppointment];
    }),
    findById: jest.fn().mockImplementation(() => Promise.resolve(savedAppointment)),
  };

  const timeSlotLogModel = {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ start: '08:00', end: '08:30' }),
      }),
    }),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
  };

  const eventEmitter = { emit: jest.fn() };
  const paymentService = {
    createDepositPaymentForAppointment: jest.fn().mockResolvedValue({
      paymentId: '64b000000000000000000105',
      paymentUrl: 'https://vnpay.example/pay',
      amount: 50000,
      purpose: 'APPOINTMENT_DEPOSIT',
    }),
  };

  const service = new AppointmentBookingService(
    eventEmitter as any,
    { get: jest.fn((key: string) => key === 'CONSULTATION_FEE' ? '150000' : undefined) } as any,
    paymentService as any,
    {
      acquireSlotLock: jest.fn().mockResolvedValue(true),
      releaseSlotLock: jest.fn().mockResolvedValue(undefined),
    } as any,
    {} as any,
    {} as any,
    appointmentModel as any,
    timeSlotLogModel as any,
    {
      findById: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ profileId: { name: 'Patient A', email: 'patient@example.com' } }),
        }),
      }),
    } as any,
    {
      findById: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ profileId: { name: 'Dr. A', email: 'doctor@example.com' } }),
        }),
      }),
    } as any,
    {} as any,
  );

  return { service, appointmentModel, paymentService, eventEmitter, getSavedAppointment: () => savedAppointment };
}

function basePayload(overrides: Record<string, any> = {}) {
  return {
    hospitalName: 'UTE Clinic',
    appointmentDate: '2026-06-01T08:00:00+07:00',
    timeSlotId: timeSlotId.toString(),
    doctor: { id: doctorId.toString(), name: 'Dr. A', email: 'doctor@example.com' },
    serviceType: ServiceType.KHAM_DICH_VU,
    paymentMethod: PaymentMethodEnum.VNPAY,
    visitType: VisitType.OFFLINE,
    paymentCategory: PaymentCategory.DICH_VU,
    depositAmount: 50000,
    reasonForAppointment: 'Follow up',
    patientEmail: 'patient@example.com',
    patientId: patientId.toString(),
    ...overrides,
  };
}

describe('AppointmentBookingService deposit booking flow', () => {
  it('keeps DICH_VU booking pending and returns deposit payment URL', async () => {
    const { service, paymentService, eventEmitter, getSavedAppointment } = createService();

    const result = await service.bookAppointment(basePayload() as any, '127.0.0.1');

    expect(result.code).toBe('PENDING');
    expect(result.data).toMatchObject({
      depositStatus: DepositStatus.PENDING,
      depositAmount: 50000,
      paymentUrl: 'https://vnpay.example/pay',
      originalAmount: 150000,
      discountAmount: 0,
      finalAmount: 150000,
    });
    expect(getSavedAppointment().appointmentStatus).toBe(AppointmentStatus.PENDING);
    expect(getSavedAppointment().depositStatus).toBe(DepositStatus.PENDING);
    expect(paymentService.createDepositPaymentForAppointment).toHaveBeenCalledWith(
      getSavedAppointment()._id.toString(),
      50000,
      '127.0.0.1',
    );
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('appointment.booking.success', expect.anything());
    expect(eventEmitter.emit).toHaveBeenCalledWith('appointment.booking.pending', expect.anything());
  });

  it('normalizes BHYT deposit to NOT_REQUIRED and confirms without deposit payment', async () => {
    const { service, paymentService, eventEmitter, getSavedAppointment } = createService();

    const result = await service.bookAppointment(basePayload({
      serviceType: ServiceType.KHAM_BHYT,
      paymentCategory: PaymentCategory.BHYT,
      depositAmount: 50000,
    }) as any, '127.0.0.1');

    expect(result.code).toBe('SUCCESS');
    expect(result.data).toMatchObject({
      depositStatus: DepositStatus.NOT_REQUIRED,
      depositAmount: 0,
      originalAmount: 150000,
      finalAmount: 150000,
    });
    expect(getSavedAppointment().appointmentStatus).toBe(AppointmentStatus.CONFIRMED);
    expect(getSavedAppointment().depositStatus).toBe(DepositStatus.NOT_REQUIRED);
    expect(paymentService.createDepositPaymentForAppointment).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith('appointment.booking.success', expect.anything());
  });

  it('rejects DICH_VU booking without a positive depositAmount', async () => {
    const { service } = createService();

    await expect(service.bookAppointment(basePayload({ depositAmount: 0 }) as any)).rejects.toThrow(
      'depositAmount must be greater than 0 for DICH_VU bookings',
    );
  });
});
