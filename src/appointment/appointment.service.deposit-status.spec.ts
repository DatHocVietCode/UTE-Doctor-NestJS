import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

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
import { AppointmentService } from './appointment.service';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { DepositStatus } from './enums/deposit-status.enum';
import { PaymentCategory } from './enums/payment-category.enum';

const appointmentId = new Types.ObjectId('64b000000000000000000301');
const patientId = new Types.ObjectId('64b000000000000000000302');
const anotherPatientId = new Types.ObjectId('64b000000000000000000303');
const paymentId = new Types.ObjectId('64b000000000000000000304');

function queryResult<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createAppointment(overrides: Record<string, any> = {}) {
  return {
    _id: appointmentId,
    appointmentStatus: AppointmentStatus.PENDING,
    patientId,
    paymentCategory: PaymentCategory.DICH_VU,
    depositStatus: DepositStatus.PENDING,
    depositAmount: 100000,
    depositPaidAmount: 0,
    depositPaidAt: undefined,
    depositPaymentId: paymentId,
    ...overrides,
  };
}

function createService(input: { appointment?: any; payment?: any } = {}) {
  const appointment = Object.prototype.hasOwnProperty.call(input, 'appointment')
    ? input.appointment
    : createAppointment();
  const payment = Object.prototype.hasOwnProperty.call(input, 'payment')
    ? input.payment
    : { _id: paymentId, status: PaymentFlowStatusEnum.PENDING };
  const paymentFindOne = jest.fn().mockReturnValue(queryResult(payment));

  const service = new AppointmentService(
    {} as any,
    { findById: jest.fn().mockReturnValue(queryResult(appointment)) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { findOne: paymentFindOne } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  return { service, paymentFindOne };
}

const patientUser = { role: RoleEnum.PATIENT, patientId: patientId.toString() };

describe('AppointmentService.getDepositStatus', () => {
  it('returns pending DICH_VU deposit status', async () => {
    const { service } = createService();

    await expect(service.getDepositStatus(appointmentId.toString(), patientUser)).resolves.toMatchObject({
      appointmentId: appointmentId.toString(),
      appointmentStatus: AppointmentStatus.PENDING,
      paymentCategory: PaymentCategory.DICH_VU,
      depositStatus: DepositStatus.PENDING,
      depositAmount: 100000,
      depositPaidAmount: 0,
      depositPaidAt: null,
      depositPaymentId: paymentId.toString(),
      paymentStatus: PaymentFlowStatusEnum.PENDING,
      paymentUrl: null,
      isConfirmed: false,
      isTerminal: false,
    });
  });

  it('returns paid and confirmed DICH_VU deposit status', async () => {
    const { service } = createService({
      appointment: createAppointment({
        appointmentStatus: AppointmentStatus.CONFIRMED,
        depositStatus: DepositStatus.PAID,
        depositPaidAmount: 100000,
        depositPaidAt: 1780200000000,
      }),
      payment: { _id: paymentId, status: PaymentFlowStatusEnum.SUCCESS },
    });

    await expect(service.getDepositStatus(appointmentId.toString(), patientUser)).resolves.toMatchObject({
      appointmentStatus: AppointmentStatus.CONFIRMED,
      depositStatus: DepositStatus.PAID,
      depositPaidAmount: 100000,
      depositPaidAt: 1780200000000,
      paymentStatus: PaymentFlowStatusEnum.SUCCESS,
      isConfirmed: true,
      isTerminal: true,
    });
  });

  it('returns failed terminal DICH_VU deposit status', async () => {
    const { service } = createService({
      appointment: createAppointment({
        appointmentStatus: AppointmentStatus.FAILED,
        depositStatus: DepositStatus.FAILED,
      }),
      payment: { _id: paymentId, status: PaymentFlowStatusEnum.FAILED },
    });

    await expect(service.getDepositStatus(appointmentId.toString(), patientUser)).resolves.toMatchObject({
      appointmentStatus: AppointmentStatus.FAILED,
      depositStatus: DepositStatus.FAILED,
      paymentStatus: PaymentFlowStatusEnum.FAILED,
      isConfirmed: false,
      isTerminal: true,
    });
  });

  it('returns stable BHYT not-required status without loading a payment', async () => {
    const { service, paymentFindOne } = createService({
      appointment: createAppointment({
        appointmentStatus: AppointmentStatus.CONFIRMED,
        paymentCategory: PaymentCategory.BHYT,
        depositStatus: DepositStatus.NOT_REQUIRED,
        depositAmount: 0,
        depositPaymentId: undefined,
      }),
    });

    await expect(service.getDepositStatus(appointmentId.toString(), patientUser)).resolves.toMatchObject({
      paymentCategory: PaymentCategory.BHYT,
      depositStatus: DepositStatus.NOT_REQUIRED,
      depositAmount: 0,
      depositPaidAmount: 0,
      depositPaymentId: null,
      paymentStatus: null,
      isConfirmed: true,
      isTerminal: true,
    });
    expect(paymentFindOne).not.toHaveBeenCalled();
  });

  it('rejects a patient querying another patient appointment', async () => {
    const { service } = createService();

    await expect(
      service.getDepositStatus(appointmentId.toString(), {
        role: RoleEnum.PATIENT,
        patientId: anotherPatientId.toString(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([RoleEnum.ADMIN, RoleEnum.RECEPTIONIST])('allows %s staff access', async (role) => {
    const { service } = createService();

    await expect(service.getDepositStatus(appointmentId.toString(), { role })).resolves.toMatchObject({
      appointmentId: appointmentId.toString(),
      depositStatus: DepositStatus.PENDING,
    });
  });

  it('returns not found when appointment does not exist', async () => {
    const { service } = createService({ appointment: null });

    await expect(service.getDepositStatus(appointmentId.toString(), patientUser)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

