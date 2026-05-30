/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { CreditService } from './credit.service';

const appointmentId = '64b000000000000000000001';
const patientId = '64b000000000000000000004';

function queryResult<T>(value: T) {
  return {
    session: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('CreditService.refundAppointmentCancellation', () => {
  it('creates an appointment-linked ledger entry before incrementing CreditWallet', async () => {
    const creditWalletModel = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const creditTransactionModel = {
      findOne: jest.fn().mockReturnValue(queryResult(null)),
      create: jest.fn().mockResolvedValue([]),
    };
    const service = new CreditService(
      creditWalletModel as any,
      creditTransactionModel as any,
    );
    const session = {} as any;

    const result = await service.refundAppointmentCancellation(
      patientId,
      80000.9,
      appointmentId,
      'patient request',
      session,
    );

    expect(result).toEqual({
      credited: true,
      amount: 80000,
      reason: `refund-appointment-cancel-${appointmentId}`,
    });
    expect(creditTransactionModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          appointmentId: expect.any(Object),
          amount: 80000,
          reason: `refund-appointment-cancel-${appointmentId}`,
          idempotencyKey: `refund-appointment-cancel-${appointmentId}`,
        }),
      ],
      { session },
    );
    expect(creditWalletModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: expect.any(Object) }),
      expect.objectContaining({
        $inc: { creditBalance: 80000, totalCredited: 80000 },
      }),
      { session, upsert: true },
    );
  });

  it('skips wallet mutation when the appointment refund ledger already exists', async () => {
    const creditWalletModel = { updateOne: jest.fn() };
    const creditTransactionModel = {
      findOne: jest
        .fn()
        .mockReturnValue(queryResult({ _id: 'existing-refund' })),
      create: jest.fn(),
    };
    const service = new CreditService(
      creditWalletModel as any,
      creditTransactionModel as any,
    );

    const result = await service.refundAppointmentCancellation(
      patientId,
      80000,
      appointmentId,
      'retry',
      {} as any,
    );

    expect(result.credited).toBe(false);
    expect(creditTransactionModel.create).not.toHaveBeenCalled();
    expect(creditWalletModel.updateOne).not.toHaveBeenCalled();
  });
});
