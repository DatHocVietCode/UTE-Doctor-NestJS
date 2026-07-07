jest.mock('src/appointment/schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('src/patient/schema/medical-record.schema', () => ({
  MedicalEncounter: class MedicalEncounter {},
  MedicalProfile: class MedicalProfile {},
}));
jest.mock('src/medicine/schema/medicine.schema', () => ({ Medicine: class Medicine {} }));
jest.mock('src/visit/schemas/visit.schema', () => ({ Visit: class Visit {} }));
jest.mock('src/payment/payment.service', () => ({ PaymentService: class PaymentService {} }));
jest.mock('./billing.schema', () => {
  const actual = jest.requireActual('./billing.schema');
  return { ...actual, Billing: class Billing {} };
});

import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentCategory } from 'src/appointment/enums/payment-category.enum';
import { BillingService } from './billing.service';
import { BillingStatus, MedicationSource } from './billing.schema';

const billingId = new Types.ObjectId('66b000000000000000000001');
const visitId = new Types.ObjectId('66b000000000000000000002');
const appointmentId = new Types.ObjectId('66b000000000000000000003');
const patientId = new Types.ObjectId('66b000000000000000000004');
const medicineId = new Types.ObjectId('66b000000000000000000005');

function query(value: any) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
    select: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
  };
}

function createBilling(overrides: Record<string, any> = {}) {
  return {
    _id: billingId,
    visitId,
    consultationFee: 200000,
    medicationFee: 0,
    totalAmount: 200000,
    insuranceAmount: 0,
    depositUsed: 0,
    creditUsed: 0,
    coinUsed: 0,
    finalPayable: 200000,
    paymentCategory: PaymentCategory.DICH_VU,
    medications: [],
    status: BillingStatus.DRAFT,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function defaultWalletSummary(_patient: string, payableBase?: number) {
  const safePayableBase = Math.max(0, Math.floor(payableBase ?? 0));
  return {
    availableCoins: 500000,
    availableCredit: 500000,
    maxApplicableDiscount: Math.max(0, Math.min(safePayableBase, 30000, Math.floor(safePayableBase * 0.1))),
  };
}

function createService(input: {
  billing?: any;
  walletSummary?: (patientId: string, payableBase?: number) => any;
  coverageRate?: string;
} = {}) {
  const billing = input.billing ?? createBilling();
  const visit = { _id: visitId, patientId, appointmentId };
  const appointment = { _id: appointmentId, paymentCategory: billing.paymentCategory };
  const session = {
    withTransaction: jest.fn(async (callback: () => Promise<void>) => callback()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const billingModel = {
    db: { startSession: jest.fn().mockResolvedValue(session) },
    findById: jest.fn().mockReturnValue(query(billing)),
  };
  const visitModel = {
    findById: jest.fn().mockReturnValue(query(visit)),
  };
  const appointmentModel = {
    findById: jest.fn().mockReturnValue(query(appointment)),
  };
  const walletService = {
    getWalletSummaryByPatientId: jest.fn(async (resolvedPatientId: string, payableBase?: number) =>
      (input.walletSummary ?? defaultWalletSummary)(resolvedPatientId, payableBase),
    ),
  };
  const paymentService = {
    createPaymentForBilling: jest.fn().mockResolvedValue({
      _id: new Types.ObjectId('66b000000000000000000006'),
      status: 'PENDING',
      amount: billing.finalPayable,
      method: 'QR',
    }),
  };

  const service = new BillingService(
    billingModel as any,
    {} as any,
    appointmentModel as any,
    {} as any,
    visitModel as any,
    { get: jest.fn((key: string) => (key === 'INSURANCE_COVERAGE_RATE' ? input.coverageRate ?? '0' : undefined)) } as any,
    {} as any,
    paymentService as any,
    walletService as any,
  );

  return { service, billing, walletService, paymentService, session };
}

async function expectBadRequest(promise: Promise<unknown>, message: string) {
  await expect(promise).rejects.toMatchObject({
    constructor: BadRequestException,
    message,
  });
}

describe('BillingService wallet cap enforcement', () => {
  it('applies coin below the canonical cap', async () => {
    const { service, billing, walletService } = createService();

    await service.applyCoin(billingId.toString(), 10000);

    expect(walletService.getWalletSummaryByPatientId).toHaveBeenCalledWith(patientId.toString(), 200000);
    expect(billing.coinUsed).toBe(10000);
    expect(billing.finalPayable).toBe(190000);
    expect(billing.save).toHaveBeenCalledTimes(1);
  });

  it('applies coin exactly at the canonical cap', async () => {
    const { service, billing } = createService();

    await service.applyCoin(billingId.toString(), 20000);

    expect(billing.coinUsed).toBe(20000);
    expect(billing.finalPayable).toBe(180000);
  });

  it('rejects coin above the 10 percent cap', async () => {
    const billing = createBilling({ totalAmount: 100000, finalPayable: 100000 });
    const { service } = createService({ billing });

    await expectBadRequest(
      service.applyCoin(billingId.toString(), 10001),
      'coinToUse cannot exceed coin discount cap (10000)',
    );
  });

  it('rejects coin above the 30000 cap', async () => {
    const billing = createBilling({ totalAmount: 500000, finalPayable: 500000 });
    const { service } = createService({ billing });

    await expectBadRequest(
      service.applyCoin(billingId.toString(), 30001),
      'coinToUse cannot exceed coin discount cap (30000)',
    );
  });

  it('rejects coin above available coin', async () => {
    const { service } = createService({
      walletSummary: (_patient, payableBase) => ({
        ...defaultWalletSummary(_patient, payableBase),
        availableCoins: 10000,
      }),
    });

    await expectBadRequest(
      service.applyCoin(billingId.toString(), 15000),
      'Insufficient coin. Balance: 10000',
    );
  });

  it('rejects coin above remaining payable after credit', async () => {
    const billing = createBilling({ creditUsed: 190000, finalPayable: 10000 });
    const { service } = createService({ billing });

    await expectBadRequest(
      service.applyCoin(billingId.toString(), 10001),
      'coinToUse cannot exceed remaining payable (10000)',
    );
  });

  it('applies credit below remaining payable', async () => {
    const billing = createBilling({ coinUsed: 20000, finalPayable: 180000 });
    const { service } = createService({ billing });

    await service.applyCredit(billingId.toString(), 50000);

    expect(billing.creditUsed).toBe(50000);
    expect(billing.finalPayable).toBe(130000);
  });

  it('allows credit to cover exactly 100 percent of remaining payable', async () => {
    const billing = createBilling({ coinUsed: 20000, finalPayable: 180000 });
    const { service } = createService({ billing });

    await service.applyCredit(billingId.toString(), 180000);

    expect(billing.creditUsed).toBe(180000);
    expect(billing.finalPayable).toBe(0);
  });

  it('rejects credit above remaining payable', async () => {
    const billing = createBilling({ coinUsed: 20000, finalPayable: 180000 });
    const { service } = createService({ billing });

    await expectBadRequest(
      service.applyCredit(billingId.toString(), 180001),
      'creditToUse cannot exceed remaining payable (180000)',
    );
  });

  it('rejects credit above available balance', async () => {
    const { service } = createService({
      walletSummary: (_patient, payableBase) => ({
        ...defaultWalletSummary(_patient, payableBase),
        availableCredit: 10000,
      }),
    });

    await expectBadRequest(
      service.applyCredit(billingId.toString(), 50000),
      'Insufficient credit. Balance: 10000',
    );
  });

  it('keeps coin and credit distinct when both are applied', async () => {
    const { service, billing } = createService();

    await service.applyCoin(billingId.toString(), 20000);
    await service.applyCredit(billingId.toString(), 180000);

    expect(billing.coinUsed).toBe(20000);
    expect(billing.creditUsed).toBe(180000);
    expect(billing.finalPayable).toBe(0);
  });

  it('finalizes with finalPayable clamped to zero when wallet values exactly consume payable', async () => {
    const billing = createBilling({
      totalAmount: 100000,
      consultationFee: 100000,
      medicationFee: 0,
      coinUsed: 10000,
      creditUsed: 90000,
      finalPayable: 0,
    });
    const { service, paymentService } = createService({ billing });

    await service.finalizeBilling(billingId.toString(), { medications: [] });

    expect(billing.finalPayable).toBe(0);
    expect(billing.status).toBe(BillingStatus.FINALIZED);
    expect(paymentService.createPaymentForBilling).toHaveBeenCalled();
  });

  it('rejects finalization when recalculated totals make coin exceed the cap', async () => {
    const billing = createBilling({
      consultationFee: 100000,
      medicationFee: 100000,
      totalAmount: 200000,
      coinUsed: 20000,
      finalPayable: 180000,
      medications: [{
        medicineId,
        medicineName: 'Med A',
        prescribedQty: 10,
        dispensedQty: 10,
        unitPrice: 10000,
        source: MedicationSource.CLINIC,
        lineTotal: 100000,
      }],
    });
    const { service, paymentService } = createService({ billing });

    await expectBadRequest(
      service.finalizeBilling(billingId.toString(), {
        medications: [{ medicineId: medicineId.toString(), dispensedQty: 0, source: MedicationSource.CLINIC }],
      }),
      'coinUsed cannot exceed coin discount cap (10000)',
    );
    expect(paymentService.createPaymentForBilling).not.toHaveBeenCalled();
  });

  it('rejects finalization when recalculated totals make credit exceed remaining payable', async () => {
    const billing = createBilling({
      consultationFee: 100000,
      medicationFee: 100000,
      totalAmount: 200000,
      coinUsed: 20000,
      creditUsed: 90000,
      finalPayable: 90000,
      medications: [{
        medicineId,
        medicineName: 'Med A',
        prescribedQty: 10,
        dispensedQty: 10,
        unitPrice: 10000,
        source: MedicationSource.CLINIC,
        lineTotal: 100000,
      }],
    });
    const { service, paymentService } = createService({ billing });

    await expectBadRequest(
      service.finalizeBilling(billingId.toString(), {
        medications: [{ medicineId: medicineId.toString(), dispensedQty: 0, source: MedicationSource.CLINIC }],
      }),
      'creditUsed cannot exceed remaining payable after coin (80000)',
    );
    expect(paymentService.createPaymentForBilling).not.toHaveBeenCalled();
  });
});
