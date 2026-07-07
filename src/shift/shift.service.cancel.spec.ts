jest.mock('src/appointment/schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('src/payment/schemas/payment.schema', () => ({ Payment: class Payment {} }));
jest.mock('src/timeslot/schemas/timeslot-data.schema', () => ({ TimeSlotData: class TimeSlotData {} }));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({ TimeSlotLog: class TimeSlotLog {} }));
jest.mock('./schema/shift.schema', () => ({ Shift: class Shift {} }));

import { AppointmentStatus } from 'src/appointment/enums/Appointment-status.enum';
import { CancellationActor } from 'src/appointment/enums/cancellation-actor.enum';
import { CancellationReasonCode } from 'src/appointment/enums/cancellation-reason-code.enum';
import { DepositStatus } from 'src/appointment/enums/deposit-status.enum';
import { PaymentCategory } from 'src/appointment/enums/payment-category.enum';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { PaymentFlowStatusEnum, PaymentPurposeEnum } from 'src/payment/enums/payment-flow.enum';
import { ShiftStatusEnum } from './enums/shift-status.enum';
import { ShiftService } from './shift.service';

function queryResult<T>(value: T) {
  return {
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function sessionQueryResult<T>(value: T) {
  return {
    session: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('ShiftService.cancelShiftById', () => {
  it('persists affected appointments as cancelled before publishing shift-cancel side effects', async () => {
    const shift = {
      _id: { toString: () => 'shift-1' },
      doctorId: { toString: () => 'doctor-1' },
      status: 'hasClient',
      timeSlots: ['slot-1'],
      startTimeEpoch: Date.UTC(2026, 0, 1),
      date: '2026-01-01',
      shift: 'morning',
      save: jest.fn().mockResolvedValue(undefined),
      toObject: jest.fn().mockReturnValue({ _id: 'shift-1' }),
    };
    const appointment = {
      _id: { toString: () => 'appt-1' },
      patientId: { toString: () => 'patient-1' },
      patientEmail: 'patient@example.com',
      appointmentStatus: AppointmentStatus.CONFIRMED,
      consultationFee: 100000,
      paymentAmount: 100000,
      timeSlot: { toString: () => 'slot-1' },
      hospitalName: 'UTE Clinic',
      doctorId: { doctorName: 'Dr A' },
    };
    const eventEmitter = { emit: jest.fn(), emitAsync: jest.fn() };
    const shiftModel = {
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(shift) }),
    };
    const timeSlotLogModel = {
      deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) }),
    };
    const appointmentModel = {
      find: jest.fn().mockReturnValue(queryResult([appointment])),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    const service = new ShiftService(
      eventEmitter as any,
      shiftModel as any,
      timeSlotLogModel as any,
      {} as any,
      appointmentModel as any,
      {} as any,
      {} as any,
      { get: jest.fn().mockReturnValue('1') } as any,
    );

    const result = await service.cancelShiftById('shift-1', 'doctor unavailable', {
      doctorId: 'doctor-1',
      email: 'doctor@example.com',
    });

    expect(result.code).toBe(ResponseCode.SUCCESS);
    expect(appointmentModel.updateOne).toHaveBeenCalledWith(
      {
        _id: appointment._id,
        appointmentStatus: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
      },
      {
        $set: expect.objectContaining({
          appointmentStatus: AppointmentStatus.CANCELLED,
          cancellationActor: CancellationActor.DOCTOR,
          cancellationReasonCode: CancellationReasonCode.DOCTOR_SHIFT_CANCELLED,
          cancellationReason: 'doctor unavailable',
        }),
      },
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'notify.patient.shift.cancelled',
      expect.objectContaining({ appointmentId: 'appt-1' }),
    );
  });

  it('does not refund a BHYT appointment when cancelling a doctor shift even if legacy fee fields are positive', async () => {
    const shift = {
      _id: { toString: () => 'shift-1' },
      doctorId: { toString: () => 'doctor-1' },
      status: ShiftStatusEnum.HAS_CLIENT,
      timeSlots: ['slot-1'],
      startTimeEpoch: Date.UTC(2026, 0, 1),
      date: '2026-01-01',
      shift: 'morning',
      save: jest.fn().mockResolvedValue(undefined),
      toObject: jest.fn().mockReturnValue({ _id: 'shift-1' }),
    };
    const appointment = {
      _id: { toString: () => 'appt-1' },
      patientId: { toString: () => 'patient-1' },
      patientEmail: 'patient@example.com',
      appointmentStatus: AppointmentStatus.CONFIRMED,
      paymentCategory: PaymentCategory.BHYT,
      depositStatus: DepositStatus.NOT_REQUIRED,
      depositPaidAmount: 0,
      consultationFee: 100000,
      paymentAmount: 100000,
      timeSlot: { toString: () => 'slot-1' },
      hospitalName: 'UTE Clinic',
      doctorId: { doctorName: 'Dr A' },
    };
    const eventEmitter = { emit: jest.fn(), emitAsync: jest.fn() };
    const shiftModel = {
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(shift) }),
    };
    const timeSlotLogModel = {
      deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) }),
    };
    const appointmentModel = {
      find: jest.fn().mockReturnValue(queryResult([appointment])),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    const service = new ShiftService(
      eventEmitter as any,
      shiftModel as any,
      timeSlotLogModel as any,
      {} as any,
      appointmentModel as any,
      {} as any,
      {} as any,
      { get: jest.fn().mockReturnValue('1') } as any,
    );

    const result = await service.cancelShiftById('shift-1', 'doctor unavailable', {
      doctorId: 'doctor-1',
      email: 'doctor@example.com',
    });

    expect(result.code).toBe(ResponseCode.SUCCESS);
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      'wallet.refund.shift.cancelled',
      expect.anything(),
    );
  });

  it('refunds a paid DICH_VU shift cancellation from depositPaidAmount and marks deposit evidence refunded', async () => {
    const session = {
      withTransaction: jest.fn(async (callback: () => Promise<void>) => callback()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const shift = {
      _id: { toString: () => 'shift-1' },
      doctorId: { toString: () => 'doctor-1' },
      status: ShiftStatusEnum.HAS_CLIENT,
      timeSlots: ['slot-1'],
      startTimeEpoch: Date.UTC(2026, 0, 1),
      date: '2026-01-01',
      shift: 'morning',
      save: jest.fn().mockResolvedValue(undefined),
      toObject: jest.fn().mockReturnValue({ _id: 'shift-1' }),
    };
    const appointment = {
      _id: { toString: () => 'appt-1' },
      patientId: { toString: () => 'patient-1' },
      patientEmail: 'patient@example.com',
      appointmentStatus: AppointmentStatus.CONFIRMED,
      paymentCategory: PaymentCategory.DICH_VU,
      depositStatus: DepositStatus.PAID,
      depositPaidAmount: 80000,
      depositPaymentId: { toString: () => 'payment-1' },
      consultationFee: 150000,
      paymentAmount: 150000,
      timeSlot: { toString: () => 'slot-1' },
      hospitalName: 'UTE Clinic',
      doctorId: { doctorName: 'Dr A' },
    };
    const depositPayment: any = {
      _id: { toString: () => 'payment-1' },
      purpose: PaymentPurposeEnum.APPOINTMENT_DEPOSIT,
      status: PaymentFlowStatusEnum.SUCCESS,
      amount: 80000,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const eventEmitter = { emit: jest.fn(), emitAsync: jest.fn() };
    const shiftModel = {
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(shift) }),
    };
    const timeSlotLogModel = {
      deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) }),
    };
    const appointmentModel = {
      find: jest.fn().mockReturnValue(queryResult([appointment])),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      db: { startSession: jest.fn().mockResolvedValue(session) },
    };
    const paymentModel = {
      findOne: jest.fn().mockReturnValue(sessionQueryResult(depositPayment)),
    };
    const creditService = {
      refundAppointmentCancellation: jest.fn().mockResolvedValue({
        credited: true,
        amount: 80000,
        reason: 'refund-appointment-cancel-appt-1',
      }),
    };
    const service = new ShiftService(
      eventEmitter as any,
      shiftModel as any,
      timeSlotLogModel as any,
      {} as any,
      appointmentModel as any,
      paymentModel as any,
      creditService as any,
      { get: jest.fn().mockReturnValue('1') } as any,
    );

    const result = await service.cancelShiftById('shift-1', 'doctor unavailable', {
      doctorId: 'doctor-1',
      email: 'doctor@example.com',
    });

    expect(result.code).toBe(ResponseCode.SUCCESS);
    expect(creditService.refundAppointmentCancellation).toHaveBeenCalledWith(
      'patient-1',
      80000,
      'appt-1',
      expect.stringContaining('doctor unavailable'),
      session,
    );
    expect(appointmentModel.updateOne).toHaveBeenCalledWith(
      { _id: appointment._id },
      { $set: { depositStatus: DepositStatus.REFUNDED } },
      { session },
    );
    expect(depositPayment.refundedAt).toBeInstanceOf(Date);
    expect(depositPayment.save).toHaveBeenCalledWith({ session });
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      'wallet.refund.shift.cancelled',
      expect.anything(),
    );
  });
});
