jest.mock('src/appointment/appointment-assignment-task.service', () => ({
  AppointmentAssignmentTaskService: class AppointmentAssignmentTaskService {},
}));
jest.mock('src/appointment/schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('src/appointment/schemas/appointment-enriched', () => ({
  buildEnrichedAppointmentPayload: jest.fn(() => ({ appointmentId: 'enriched' })),
}));
jest.mock('src/billing/billing.schema', () => {
  const actual = jest.requireActual('src/billing/billing.schema');
  return { ...actual, Billing: class Billing {} };
});
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

import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BillingStatus } from 'src/billing/billing.schema';
import { PaymentFlowMethodEnum, PaymentFlowStatusEnum, PaymentPurposeEnum } from './enums/payment-flow.enum';
import { PaymentService } from './payment.service';

const paymentId = new Types.ObjectId('66c000000000000000000001');
const billingId = new Types.ObjectId('66c000000000000000000002');
const visitId = new Types.ObjectId('66c000000000000000000003');
const patientId = new Types.ObjectId('66c000000000000000000004');
const appointmentId = new Types.ObjectId('66c000000000000000000005');

function query(value: any) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
  };
}

function createPayment(overrides: Record<string, any> = {}) {
  return {
    _id: paymentId,
    purpose: PaymentPurposeEnum.BILLING,
    billingId,
    amount: 170000,
    method: PaymentFlowMethodEnum.QR,
    status: PaymentFlowStatusEnum.PENDING,
    expireAt: new Date('2099-07-01T00:00:00.000Z'),
    transactionId: undefined,
    paidAt: undefined,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createBilling(overrides: Record<string, any> = {}) {
  return {
    _id: billingId,
    visitId,
    status: BillingStatus.FINALIZED,
    totalAmount: 200000,
    insuranceAmount: 0,
    depositUsed: 0,
    creditUsed: 0,
    coinUsed: 0,
    finalPayable: 200000,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createService(input: {
  payment?: any;
  existingBillingPayment?: any | null;
  billing?: any;
  availableCredit?: number;
  coinEarnAmount?: number;
} = {}) {
  const payment = input.payment ?? createPayment();
  const existingBillingPayment = Object.prototype.hasOwnProperty.call(input, 'existingBillingPayment')
    ? input.existingBillingPayment
    : payment;
  const billing = input.billing ?? createBilling();
  const visit = { _id: visitId, patientId, appointmentId };
  const session = {
    withTransaction: jest.fn(async (callback: () => Promise<void>) => callback()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const creditWallet = {
    creditBalance: input.availableCredit ?? 500000,
    totalDebited: 0,
    save: jest.fn().mockResolvedValue(undefined),
  };
  const coinWallet = {
    coinBalance: input.coinEarnAmount ?? 500000,
    totalCoinUsed: 0,
    save: jest.fn().mockResolvedValue(undefined),
  };
  const earnTransactionId = new Types.ObjectId('66c000000000000000000006');
  const coinEarns = (input.coinEarnAmount ?? 500000) > 0
    ? [{
        _id: earnTransactionId,
        amount: input.coinEarnAmount ?? 500000,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }]
    : [];

  const paymentModel = {
    db: { startSession: jest.fn().mockResolvedValue(session) },
    findById: jest.fn().mockReturnValue(query(payment)),
    findOne: jest.fn().mockReturnValue(query(existingBillingPayment)),
    create: jest.fn().mockResolvedValue([payment]),
  };
  const billingModel = {
    findById: jest.fn().mockReturnValue(query(billing)),
  };
  const visitModel = {
    findById: jest.fn().mockReturnValue(query(visit)),
  };
  const creditWalletModel = {
    findOne: jest.fn().mockReturnValue(query(creditWallet)),
  };
  const creditTransactionModel = {
    create: jest.fn().mockResolvedValue([]),
  };
  const coinWalletModel = {
    findOne: jest.fn().mockReturnValue(query(coinWallet)),
  };
  const coinTransactionModel = {
    find: jest.fn().mockReturnValue(query(coinEarns)),
    create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId('66c000000000000000000007') }]),
  };
  const coinSpendAllocationModel = {
    find: jest.fn().mockReturnValue(query([])),
    create: jest.fn().mockResolvedValue([]),
  };
  const eventEmitter = { emit: jest.fn() };

  const service = new PaymentService(
    paymentModel as any,
    {} as any,
    billingModel as any,
    visitModel as any,
    {} as any,
    {} as any,
    {} as any,
    creditWalletModel as any,
    creditTransactionModel as any,
    coinWalletModel as any,
    coinTransactionModel as any,
    coinSpendAllocationModel as any,
    { get: jest.fn((key: string) => (key === 'VN_PAY_EXPIRE_MINUTES' ? '15' : undefined)) } as any,
    eventEmitter as any,
    {} as any,
    {} as any,
  );

  return {
    service,
    paymentModel,
    payment,
    billing,
    creditWallet,
    coinWallet,
    creditTransactionModel,
    coinTransactionModel,
    coinSpendAllocationModel,
    eventEmitter,
  };
}

async function expectBadRequest(promise: Promise<unknown>, message: string) {
  await expect(promise).rejects.toMatchObject({
    constructor: BadRequestException,
    message,
  });
}

describe('PaymentService billing wallet validation', () => {
  it('rejects stored coinUsed above the canonical cap before wallet deduction', async () => {
    const { service, billing, creditTransactionModel, coinTransactionModel, coinSpendAllocationModel } = createService({
      billing: createBilling({
        totalAmount: 100000,
        coinUsed: 10001,
        creditUsed: 0,
        finalPayable: 89999,
      }),
    });

    await expectBadRequest(
      service.markPaymentSuccess(paymentId.toString(), 'cashier', 'CASH'),
      'coinUsed cannot exceed coin discount cap (10000)',
    );
    expect(billing.save).not.toHaveBeenCalled();
    expect(creditTransactionModel.create).not.toHaveBeenCalled();
    expect(coinTransactionModel.create).not.toHaveBeenCalled();
    expect(coinSpendAllocationModel.create).not.toHaveBeenCalled();
  });

  it('rejects stored creditUsed above remaining payable before wallet deduction', async () => {
    const { service, billing, creditTransactionModel, coinTransactionModel } = createService({
      billing: createBilling({
        totalAmount: 100000,
        coinUsed: 10000,
        creditUsed: 90001,
        finalPayable: 0,
      }),
    });

    await expectBadRequest(
      service.markPaymentSuccess(paymentId.toString(), 'cashier', 'CASH'),
      'creditUsed cannot exceed remaining payable after coin (90000)',
    );
    expect(billing.save).not.toHaveBeenCalled();
    expect(creditTransactionModel.create).not.toHaveBeenCalled();
    expect(coinTransactionModel.create).not.toHaveBeenCalled();
  });

  it('rejects stored creditUsed above available balance before wallet deduction', async () => {
    const { service, creditWallet, creditTransactionModel, coinTransactionModel } = createService({
      availableCredit: 10000,
      billing: createBilling({
        totalAmount: 100000,
        creditUsed: 50000,
        finalPayable: 50000,
      }),
    });

    await expectBadRequest(
      service.markPaymentSuccess(paymentId.toString(), 'cashier', 'CASH'),
      'Insufficient credit. Balance: 10000, Required: 50000',
    );
    expect(creditWallet.save).not.toHaveBeenCalled();
    expect(creditTransactionModel.create).not.toHaveBeenCalled();
    expect(coinTransactionModel.create).not.toHaveBeenCalled();
  });

  it('settles zero-payable billing manually and commits wallet deductions once', async () => {
    const { service, payment, billing, creditWallet, coinWallet, creditTransactionModel, coinTransactionModel, coinSpendAllocationModel, eventEmitter } = createService({
      payment: createPayment({ amount: 0, expireAt: new Date('2000-01-01T00:00:00.000Z') }),
      billing: createBilling({
        totalAmount: 250000,
        depositUsed: 100000,
        creditUsed: 135000,
        coinUsed: 15000,
        finalPayable: 0,
      }),
      availableCredit: 200000,
      coinEarnAmount: 20000,
    });

    const result = await service.markPaymentSuccess(paymentId.toString(), 'cashier', 'CASH');

    expect(result.data).toMatchObject({
      paymentId: paymentId.toString(),
      billingId: billingId.toString(),
      status: PaymentFlowStatusEnum.SUCCESS,
      amount: 0,
      method: PaymentFlowMethodEnum.CASH,
    });
    expect(creditWallet.creditBalance).toBe(65000);
    expect(creditWallet.totalDebited).toBe(135000);
    expect(coinWallet.totalCoinUsed).toBe(15000);
    expect(creditTransactionModel.create).toHaveBeenCalledTimes(1);
    expect(coinTransactionModel.create).toHaveBeenCalledTimes(1);
    expect(coinSpendAllocationModel.create).toHaveBeenCalledTimes(1);
    expect(payment.status).toBe(PaymentFlowStatusEnum.SUCCESS);
    expect(payment.expireAt).toBeNull();
    expect(billing.status).toBe(BillingStatus.PAID);
    expect(eventEmitter.emit).toHaveBeenCalledWith('domain.payment.success', expect.objectContaining({
      amount: 0,
      channel: 'CASH',
    }));
  });

  it('does not deduct wallets again when zero-payable settlement is repeated', async () => {
    const { service, payment, creditWallet, coinWallet, creditTransactionModel, coinTransactionModel, coinSpendAllocationModel } = createService({
      payment: createPayment({ amount: 0 }),
      billing: createBilling({
        totalAmount: 250000,
        depositUsed: 100000,
        creditUsed: 135000,
        coinUsed: 15000,
        finalPayable: 0,
      }),
      availableCredit: 200000,
      coinEarnAmount: 20000,
    });

    await service.markPaymentSuccess(paymentId.toString(), 'cashier', 'CASH');
    await service.markPaymentSuccess(paymentId.toString(), 'cashier', 'CASH');

    expect(creditWallet.creditBalance).toBe(65000);
    expect(creditWallet.totalDebited).toBe(135000);
    expect(coinWallet.totalCoinUsed).toBe(15000);
    expect(creditTransactionModel.create).toHaveBeenCalledTimes(1);
    expect(coinTransactionModel.create).toHaveBeenCalledTimes(1);
    expect(coinSpendAllocationModel.create).toHaveBeenCalledTimes(1);
    expect(payment.save).toHaveBeenCalledTimes(2);
  });

  it('rejects QR for zero-payable billing without creating a pending payment', async () => {
    const { service, paymentModel } = createService({
      existingBillingPayment: null,
      payment: createPayment({ amount: 0 }),
      billing: createBilling({
        totalAmount: 250000,
        depositUsed: 100000,
        creditUsed: 135000,
        coinUsed: 15000,
        finalPayable: 0,
      }),
    });

    await expectBadRequest(
      service.createPaymentUrlForBilling(billingId.toString(), '127.0.0.1'),
      'No QR payment is required because this billing is fully covered.',
    );
    expect(paymentModel.create).not.toHaveBeenCalled();
  });
});
