jest.mock('src/appointment/appointment-assignment-task.service', () => ({
  AppointmentAssignmentTaskService: class AppointmentAssignmentTaskService {},
}));
jest.mock('src/appointment/schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('src/appointment/schemas/appointment-enriched', () => ({
  buildEnrichedAppointmentPayload: jest.fn(() => ({ appointmentId: 'enriched' })),
}));
jest.mock('src/billing/billing.schema', () => ({ Billing: class Billing {} }));
jest.mock('src/doctor/schema/doctor.schema', () => ({ Doctor: class Doctor {} }));
jest.mock('src/patient/schema/patient.schema', () => ({ Patient: class Patient {} }));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({ TimeSlotLog: class TimeSlotLog {} }));
jest.mock('src/visit/schemas/visit.schema', () => ({ Visit: class Visit {} }));
jest.mock('src/wallet/coin/schemas/coin-spend-allocation.schema', () => ({
  CoinSpendAllocation: class CoinSpendAllocation {},
}));
jest.mock('src/wallet/coin/schemas/coin-transaction.schema', () => ({
  CoinTransaction: class CoinTransaction {},
}));
jest.mock('src/wallet/coin/schemas/coin-wallet.schema', () => ({ CoinWallet: class CoinWallet {} }));
jest.mock('src/wallet/credit/schemas/credit-transaction.schema', () => ({
  CreditTransaction: class CreditTransaction {},
}));
jest.mock('src/wallet/credit/schemas/credit-wallet.schema', () => ({ CreditWallet: class CreditWallet {} }));
jest.mock('./schemas/payment.schema', () => ({ Payment: class Payment {} }));

import { Types } from 'mongoose';
import { AppointmentStatus } from 'src/appointment/enums/Appointment-status.enum';
import { AssignmentStatus } from 'src/appointment/enums/assignment-status.enum';
import { DepositStatus } from 'src/appointment/enums/deposit-status.enum';
import { PaymentCategory } from 'src/appointment/enums/payment-category.enum';
import { PaymentFlowMethodEnum, PaymentFlowStatusEnum, PaymentPurposeEnum } from './enums/payment-flow.enum';
import { PaymentService } from './payment.service';

const paymentId = new Types.ObjectId('65a000000000000000000001');
const appointmentId = new Types.ObjectId('65a000000000000000000002');
const patientId = new Types.ObjectId('65a000000000000000000003');
const doctorId = new Types.ObjectId('65a000000000000000000004');
const timeSlotId = new Types.ObjectId('65a000000000000000000005');
const paidAt = new Date('2026-06-16T03:00:00.000Z');

function modelById(document: any) {
  return {
    exec: jest.fn().mockResolvedValue(document),
    session: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(document),
    }),
  };
}

function createDepositPayment(overrides: Record<string, any> = {}) {
  return {
    _id: paymentId,
    purpose: PaymentPurposeEnum.APPOINTMENT_DEPOSIT,
    appointmentId,
    amount: 50000,
    method: PaymentFlowMethodEnum.QR,
    status: PaymentFlowStatusEnum.PENDING,
    // Keep the fixture well ahead of the real clock so the success-path tests
    // exercise the assignment boundary instead of the expiry guard.
    expireAt: new Date('2099-06-16T03:15:00.000Z'),
    transactionId: undefined,
    paidAt: undefined,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createAppointment(overrides: Record<string, any> = {}) {
  return {
    _id: appointmentId,
    appointmentStatus: AppointmentStatus.PENDING,
    assignmentStatus: AssignmentStatus.AWAITING_ASSIGNMENT,
    paymentCategory: PaymentCategory.DICH_VU,
    depositStatus: DepositStatus.PENDING,
    depositPaidAmount: 0,
    depositPaidAt: undefined,
    depositPaymentId: undefined,
    doctorId: undefined,
    timeSlot: undefined,
    patientId,
    patientEmail: 'patient@example.com',
    specialtyId: new Types.ObjectId('65a000000000000000000006'),
    reasonForAppointment: 'chest pain',
    consultationFee: 150000,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createService(input: { payment?: any; appointment?: any } = {}) {
  const payment = input.payment ?? createDepositPayment();
  const appointment = input.appointment ?? createAppointment();
  const session = {
    withTransaction: jest.fn(async (callback: () => Promise<void>) => callback()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const paymentModel = {
    db: { startSession: jest.fn().mockResolvedValue(session) },
    findById: jest.fn().mockReturnValue(modelById(payment)),
  };
  const appointmentModel = {
    findById: jest.fn().mockReturnValue(modelById(appointment)),
  };
  const eventEmitter = { emit: jest.fn() };
  const assignmentTaskService = {
    createAssignmentTaskAfterDepositSuccess: jest.fn().mockResolvedValue({
      taskId: '65a000000000000000000007',
      appointmentId: appointmentId.toString(),
      deadlineAt: paidAt.getTime() + 30 * 60_000,
      created: true,
      patientEmail: 'patient@example.com',
      specialty: appointment.specialtyId?.toString?.(),
      reasonForAppointment: 'chest pain',
    }),
  };
  const doctorModel = {
    findById: jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ profileId: { name: 'Dr. A', email: 'dr@example.com' } }),
      }),
    }),
  };
  const patientModel = {
    findById: jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ profileId: { name: 'Patient A', email: 'patient@example.com' } }),
      }),
    }),
  };

  const service = new PaymentService(
    paymentModel as any,
    appointmentModel as any,
    {} as any,
    {} as any,
    {} as any,
    patientModel as any,
    doctorModel as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { get: jest.fn((key: string) => (key === 'ASSIGNMENT_DEADLINE_MINUTES' ? '30' : undefined)) } as any,
    eventEmitter as any,
    {} as any,
    assignmentTaskService as any,
  );

  return { service, payment, appointment, eventEmitter, assignmentTaskService, session };
}

describe('PaymentService appointment deposit success', () => {
  it('keeps broad DICH_VU pending and creates assignment work after deposit success', async () => {
    const { service, payment, appointment, eventEmitter, assignmentTaskService, session } = createService();

    const result = await service.handleVnpayPaymentResultByTxnRef(paymentId.toString(), 'vnpay', { paidAt });

    expect(result.code).toBe('SUCCESS');
    expect(payment.status).toBe(PaymentFlowStatusEnum.SUCCESS);
    expect(payment.expireAt).toBeNull();
    expect(appointment.depositStatus).toBe(DepositStatus.PAID);
    expect(appointment.depositPaidAmount).toBe(50000);
    expect(appointment.depositPaidAt).toBe(paidAt.getTime());
    expect(appointment.appointmentStatus).toBe(AppointmentStatus.PENDING);
    expect(appointment.assignmentStatus).toBe(AssignmentStatus.AWAITING_ASSIGNMENT);
    expect(assignmentTaskService.createAssignmentTaskAfterDepositSuccess).toHaveBeenCalledWith({
      appointmentId: appointmentId.toString(),
      deadlineAt: paidAt.getTime() + 30 * 60_000,
      specialty: appointment.specialtyId.toString(),
      reasonForAppointment: 'chest pain',
      patientEmail: 'patient@example.com',
      session,
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith('appointment.assignment.created', expect.any(Object));
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('appointment.booking.success', expect.anything());
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('domain.visit.created', expect.anything());
  });

  it('does not re-emit assignment-created when a retried success callback finds an existing task', async () => {
    const payment = createDepositPayment({ status: PaymentFlowStatusEnum.SUCCESS });
    const appointment = createAppointment({
      depositStatus: DepositStatus.PAID,
      depositPaidAmount: 50000,
      depositPaidAt: paidAt.getTime(),
    });
    const { service, eventEmitter, assignmentTaskService } = createService({ payment, appointment });
    assignmentTaskService.createAssignmentTaskAfterDepositSuccess
      .mockResolvedValueOnce({
        taskId: '65a000000000000000000007',
        appointmentId: appointmentId.toString(),
        deadlineAt: paidAt.getTime() + 30 * 60_000,
        created: false,
      });

    await service.handleVnpayPaymentResultByTxnRef(paymentId.toString(), 'vnpay', { paidAt });

    expect(assignmentTaskService.createAssignmentTaskAfterDepositSuccess).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('appointment.assignment.created', expect.anything());
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('appointment.booking.success', expect.anything());
  });

  it('keeps normal doctor-selected DICH_VU confirmation behavior unchanged', async () => {
    const appointment = createAppointment({
      assignmentStatus: AssignmentStatus.NONE,
      doctorId,
      timeSlot: timeSlotId,
    });
    const { service, eventEmitter, assignmentTaskService } = createService({ appointment });

    await service.handleVnpayPaymentResultByTxnRef(paymentId.toString(), 'vnpay', { paidAt });

    expect(appointment.appointmentStatus).toBe(AppointmentStatus.CONFIRMED);
    expect(assignmentTaskService.createAssignmentTaskAfterDepositSuccess).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith('appointment.booking.success', expect.any(Object));
  });
});
