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

import { Types } from 'mongoose';
import { DepositStatus } from 'src/appointment/enums/deposit-status.enum';
import { PaymentCategory } from 'src/appointment/enums/payment-category.enum';
import { BillingService } from './billing.service';
import { BillingStatus } from './billing.schema';

const visitId = new Types.ObjectId('64b000000000000000000201');
const appointmentId = new Types.ObjectId('64b000000000000000000202');

function query(value: any) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
    select: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
  };
}

function createService(appointment: Record<string, any>) {
  let createdBilling: any = null;
  const billingModel = {
    findOne: jest.fn().mockReturnValue(query(null)),
    create: jest.fn(async (payload: any) => {
      createdBilling = { _id: new Types.ObjectId(), ...payload };
      return createdBilling;
    }),
  };

  const encounterModel = {
    findOne: jest
      .fn()
      .mockReturnValueOnce(query({ appointmentId, prescriptions: [] }))
      .mockReturnValueOnce(query({ prescriptions: [] })),
  };

  const appointmentModel = {
    findById: jest.fn().mockReturnValue(query({
      _id: appointmentId,
      consultationFee: 120000,
      paymentCategory: PaymentCategory.DICH_VU,
      depositAmount: 50000,
      ...appointment,
    })),
  };

  const service = new BillingService(
    billingModel as any,
    encounterModel as any,
    appointmentModel as any,
    {} as any,
    {} as any,
    { get: jest.fn((key: string) => key === 'CONSULTATION_FEE' ? '120000' : '0') } as any,
    {} as any,
    {} as any,
    {} as any,
  );

  return { service, getCreatedBilling: () => createdBilling };
}

describe('BillingService deposit evidence semantics', () => {
  it('uses depositPaidAmount only when appointment depositStatus is PAID', async () => {
    const { service, getCreatedBilling } = createService({
      depositStatus: DepositStatus.PAID,
      depositPaidAmount: 50000,
    });

    await service.createDraftBilling(visitId.toString());

    expect(getCreatedBilling()).toMatchObject({
      status: BillingStatus.DRAFT,
      depositUsed: 50000,
      finalPayable: 70000,
    });
  });

  it('does not use requested depositAmount when deposit is not paid', async () => {
    const { service, getCreatedBilling } = createService({
      depositStatus: DepositStatus.PENDING,
      depositPaidAmount: 0,
      depositAmount: 50000,
    });

    await service.createDraftBilling(visitId.toString());

    expect(getCreatedBilling()).toMatchObject({
      depositUsed: 0,
      finalPayable: 120000,
    });
  });
});
