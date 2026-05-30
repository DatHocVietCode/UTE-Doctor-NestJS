import { BadRequestException, ForbiddenException } from '@nestjs/common';

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

import { RoleEnum } from 'src/common/enum/role.enum';
import { PaymentFlowStatusEnum } from 'src/payment/enums/payment-flow.enum';
import { VisitStatus } from 'src/visit/enums/visit-status.enum';
import { AppointmentService } from './appointment.service';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { DepositStatus } from './enums/deposit-status.enum';
import { PaymentCategory } from './enums/payment-category.enum';

const appointmentId = '64b000000000000000000001';
const visitId = '64b000000000000000000002';
const timeSlotId = '64b000000000000000000003';
const patientId = '64b000000000000000000004';
const patientUser = { role: RoleEnum.PATIENT, patientId };
const staffUser = { role: RoleEnum.RECEPTIONIST };

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
    patientId: { toString: () => patientId },
    patientEmail: 'patient@example.com',
    doctorId: 'doctor-1',
    hospitalName: 'UTE Clinic',
    paymentCategory: PaymentCategory.BHYT,
    depositAmount: 0,
    depositPaidAmount: 0,
    depositStatus: DepositStatus.NOT_REQUIRED,
    paymentAmount: 100000,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createDepositPayment(overrides: Record<string, any> = {}) {
  return {
    status: PaymentFlowStatusEnum.SUCCESS,
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
  billingPaymentExists?: any;
  depositPayments?: any[];
  slotReleaseResult?: any;
  refundRate?: string;
} = {}) {
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
    updateOne: jest.fn().mockResolvedValue(input.slotReleaseResult ?? { modifiedCount: 1 }),
  };
  const creditService = {
    refundAppointmentCancellation: jest.fn().mockResolvedValue({
      credited: true,
      amount: 0,
      reason: `refund-appointment-cancel-${appointmentId}`,
    }),
  };

  const paymentModel = {
    exists: jest.fn().mockReturnValue({
      session: jest.fn().mockResolvedValue(input.billingPaymentExists ?? null),
    }),
    find: jest.fn().mockReturnValue(queryResult(input.depositPayments ?? [])),
  };
  const config = {
    get: jest.fn().mockReturnValue(input.refundRate),
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
    paymentModel as any,
    {} as any,
    {} as any,
    creditService as any,
    config as any,
  );

  return { service, eventEmitter, timeSlotLogModel, appointment, session, creditService, paymentModel };
}

async function expectBlocked(service: AppointmentService, blockedReason: string) {
  await expect(service.cancelAppointment(appointmentId, undefined, patientUser)).rejects.toMatchObject({
    response: { data: { blockedReason } },
  } as BadRequestException);
}

describe('AppointmentService.cancelAppointment', () => {
  it('cancels appointment and CREATED visit, releases a booked slot, and preserves fanout', async () => {
    const visit = { _id: visitId, status: VisitStatus.CREATED, save: jest.fn().mockResolvedValue(undefined) };
    const { service, eventEmitter, timeSlotLogModel, appointment } = createService({ visit });

    const result = await service.cancelAppointment(appointmentId, 'patient request', patientUser);

    expect(result.code).toBe('SUCCESS');
    expect(result.data.refundAmount).toBe(0);
    expect(appointment.appointmentStatus).toBe(AppointmentStatus.CANCELLED);
    expect(visit.status).toBe(VisitStatus.CANCELLED);
    expect(timeSlotLogModel.updateOne).toHaveBeenCalledWith(
      { _id: appointment.timeSlot, status: 'booked' },
      { $set: { status: 'available' } },
      expect.any(Object),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('notify.patient.appointment.cancelled', expect.any(Object));
    expect(eventEmitter.emit).toHaveBeenCalledWith('mail.patient.appointment.cancelled', expect.any(Object));
    expect(eventEmitter.emit).toHaveBeenCalledWith('socket.appointment.cancelled', expect.any(Object));
  });

  it.each([
    [VisitStatus.CHECKED_IN, 'VISIT_ALREADY_STARTED'],
    [VisitStatus.IN_PROGRESS, 'VISIT_ALREADY_STARTED'],
    [VisitStatus.COMPLETED, 'VISIT_COMPLETED'],
    [VisitStatus.CANCELLED, 'VISIT_ALREADY_STARTED'],
  ])('blocks when visit status is %s', async (status, blockedReason) => {
    const { service } = createService({ visit: { _id: visitId, status, save: jest.fn() } });
    await expectBlocked(service, blockedReason);
  });

  it('blocks when a medical encounter exists', async () => {
    const { service } = createService({ encounterExists: { _id: 'encounter-1' } });
    await expectBlocked(service, 'MEDICAL_ENCOUNTER_EXISTS');
  });

  it('blocks when billing exists', async () => {
    const { service } = createService({ billing: { _id: 'billing-1' } });
    await expectBlocked(service, 'BILLING_EXISTS');
  });

  it('blocks when billing payment exists', async () => {
    const { service } = createService({
      billing: { _id: 'billing-1' },
      billingPaymentExists: { _id: 'payment-1' },
    });
    await expectBlocked(service, 'PAYMENT_EXISTS');
  });

  it('refunds verified DICH_VU depositPaidAmount into CreditWallet with appointment reference', async () => {
    const depositPayment = createDepositPayment();
    const appointment = createAppointment({
      paymentCategory: PaymentCategory.DICH_VU,
      depositAmount: 999999,
      depositPaidAmount: 80000,
      depositStatus: DepositStatus.PAID,
    });
    const { service, creditService } = createService({ appointment, depositPayments: [depositPayment] });

    const result = await service.cancelAppointment(appointmentId, 'patient request', patientUser);

    expect(result.data.refundAmount).toBe(80000);
    expect(creditService.refundAppointmentCancellation).toHaveBeenCalledWith(
      patientId,
      80000,
      appointmentId,
      'patient request',
      expect.any(Object),
    );
    expect(appointment.depositStatus).toBe(DepositStatus.REFUNDED);
    expect(depositPayment.refundedAt).toBeInstanceOf(Date);
  });

  it('applies configured refund rate to verified depositPaidAmount', async () => {
    const appointment = createAppointment({
      paymentCategory: PaymentCategory.DICH_VU,
      depositPaidAmount: 80001,
      depositStatus: DepositStatus.PAID,
    });
    const { service, creditService } = createService({
      appointment,
      depositPayments: [createDepositPayment()],
      refundRate: '0.5',
    });

    await service.cancelAppointment(appointmentId, undefined, patientUser);
    expect(creditService.refundAppointmentCancellation).toHaveBeenCalledWith(
      patientId,
      40000,
      appointmentId,
      'Appointment cancelled',
      expect.any(Object),
    );
  });

  it('does not refund BHYT or unpaid deposits', async () => {
    const { service, creditService } = createService();
    await service.cancelAppointment(appointmentId, undefined, patientUser);
    expect(creditService.refundAppointmentCancellation).not.toHaveBeenCalled();
  });

  it('blocks a pending deposit callback race', async () => {
    const { service } = createService({
      depositPayments: [createDepositPayment({ status: PaymentFlowStatusEnum.PENDING })],
    });
    await expectBlocked(service, 'APPOINTMENT_DEPOSIT_PAYMENT_PENDING');
  });

  it('blocks ambiguous deposit records', async () => {
    const { service } = createService({
      depositPayments: [createDepositPayment(), createDepositPayment()],
    });
    await expectBlocked(service, 'APPOINTMENT_DEPOSIT_PAYMENT_AMBIGUOUS');
  });

  it('fails consistently when booked slot release does not modify a slot', async () => {
    const { service } = createService({ slotReleaseResult: { modifiedCount: 0 } });
    await expectBlocked(service, 'TIME_SLOT_RELEASE_FAILED');
  });

  it('blocks cancellation within 24 hours without refunding', async () => {
    const appointment = createAppointment({ scheduledAt: Date.now() + 60 * 60 * 1000 });
    const { service, creditService } = createService({ appointment });
    await expectBlocked(service, 'APPOINTMENT_NOT_CANCELABLE');
    expect(creditService.refundAppointmentCancellation).not.toHaveBeenCalled();
  });

  it('rejects a patient cancelling another patient appointment', async () => {
    const { service } = createService();
    await expect(
      service.cancelAppointment(appointmentId, undefined, { role: RoleEnum.PATIENT, patientId: 'other-patient' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows receptionist cancellation', async () => {
    const { service } = createService();
    await expect(service.cancelAppointment(appointmentId, undefined, staffUser)).resolves.toMatchObject({ code: 'SUCCESS' });
  });

  it('does not double refund after the appointment is already cancelled', async () => {
    const appointment = createAppointment({ appointmentStatus: AppointmentStatus.CANCELLED });
    const { service, creditService } = createService({ appointment });
    await expectBlocked(service, 'APPOINTMENT_NOT_CANCELABLE');
    expect(creditService.refundAppointmentCancellation).not.toHaveBeenCalled();
  });
});
