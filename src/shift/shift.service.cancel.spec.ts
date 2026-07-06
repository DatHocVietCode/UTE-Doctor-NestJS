jest.mock('src/appointment/schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('src/timeslot/schemas/timeslot-data.schema', () => ({ TimeSlotData: class TimeSlotData {} }));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({ TimeSlotLog: class TimeSlotLog {} }));
jest.mock('./schema/shift.schema', () => ({ Shift: class Shift {} }));

import { AppointmentStatus } from 'src/appointment/enums/Appointment-status.enum';
import { CancellationActor } from 'src/appointment/enums/cancellation-actor.enum';
import { CancellationReasonCode } from 'src/appointment/enums/cancellation-reason-code.enum';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { ShiftStatusEnum } from './enums/shift-status.enum';
import { ShiftService } from './shift.service';

function queryResult<T>(value: T) {
  return {
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
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
});
