import { BadRequestException } from '@nestjs/common';

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

import { AppointmentService } from './appointment.service';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { VisitStatus } from 'src/visit/enums/visit-status.enum';

const appointmentId = '64b000000000000000000001';
const visitId = '64b000000000000000000002';
const timeSlotId = '64b000000000000000000003';

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
    scheduledAt: Date.now() + 72 * 60 * 60 * 1000,
    timeSlot: { toString: () => timeSlotId },
    patientId: { toString: () => 'patient-1' },
    patientEmail: 'patient@example.com',
    doctorId: 'doctor-1',
    hospitalName: 'UTE Clinic',
    depositAmount: 0,
    paymentAmount: 100000,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createService(input: {
  appointment?: any;
  freshAppointment?: any;
  visit?: any;
  encounterExists?: any;
  billing?: any;
  paymentExists?: any;
}) {
  const session = {
    withTransaction: jest.fn(async (callback: () => Promise<void>) => callback()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const appointment = input.appointment ?? createAppointment();
  const freshAppointment = input.freshAppointment ?? appointment;
  const appointmentFindById = jest
    .fn()
    .mockResolvedValueOnce(appointment)
    .mockReturnValueOnce({
      session: jest.fn().mockResolvedValue(freshAppointment),
    });

  const eventEmitter = { emit: jest.fn() };
  const timeSlotLogModel = {
    findById: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ label: '08:00-08:30' }),
    }),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
  };

  const service = new AppointmentService(
    eventEmitter as any,
    { findById: appointmentFindById, db: { startSession: jest.fn().mockResolvedValue(session) } } as any,
    timeSlotLogModel as any,
    {} as any,
    {
      findById: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ profileId: { email: 'doctor@example.com', name: 'Dr. A' } }),
        }),
      }),
    } as any,
    {} as any,
    {
      findOne: jest.fn().mockReturnValue(queryResult(input.visit ?? {
        _id: visitId,
        status: VisitStatus.CREATED,
        save: jest.fn().mockResolvedValue(undefined),
      })),
    } as any,
    {
      exists: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(input.encounterExists ?? null),
      }),
    } as any,
    {
      findOne: jest.fn().mockReturnValue(queryResult(input.billing ?? null)),
    } as any,
    {
      exists: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(input.paymentExists ?? null),
      }),
    } as any,
    {} as any,
    {} as any,
  );

  return { service, eventEmitter, timeSlotLogModel, appointment, session };
}

describe('AppointmentService.cancelAppointment', () => {
  it('cancels appointment and CREATED visit without wallet refund', async () => {
    const visit = { _id: visitId, status: VisitStatus.CREATED, save: jest.fn().mockResolvedValue(undefined) };
    const { service, eventEmitter, timeSlotLogModel, appointment } = createService({ visit });

    const result = await service.cancelAppointment(appointmentId, 'patient request');

    expect(result.code).toBe('SUCCESS');
    expect(result.data.refundAmount).toBe(0);
    expect(result.data.refundReason).toBe('No automatic refund for appointment cancellation in visit/billing flow');
    expect(appointment.appointmentStatus).toBe(AppointmentStatus.CANCELLED);
    expect(visit.status).toBe(VisitStatus.CANCELLED);
    expect(timeSlotLogModel.updateOne).toHaveBeenCalledWith(
      { _id: appointment.timeSlot },
      { $set: { status: 'available' } },
      expect.any(Object),
    );
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('appointment.cancelled', expect.anything());
    expect(eventEmitter.emit).toHaveBeenCalledWith('socket.appointment.cancelled', expect.any(Object));
  });

  it('blocks when visit is already checked in', async () => {
    const { service } = createService({
      visit: { _id: visitId, status: VisitStatus.CHECKED_IN, save: jest.fn() },
    });

    await expect(service.cancelAppointment(appointmentId)).rejects.toMatchObject({
      response: {
        data: { blockedReason: 'VISIT_ALREADY_STARTED' },
      },
    } as BadRequestException);
  });

  it('blocks when billing exists', async () => {
    const { service } = createService({
      billing: { _id: 'billing-1' },
      paymentExists: null,
    });

    await expect(service.cancelAppointment(appointmentId)).rejects.toMatchObject({
      response: {
        data: { blockedReason: 'BILLING_EXISTS' },
      },
    } as BadRequestException);
  });
});
