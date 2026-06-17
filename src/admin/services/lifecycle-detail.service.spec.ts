// LifecycleDetailService imports AppointmentLifecycleService, which imports schemas;
// mock them so the import graph loads under ts-jest. The lifecycle service itself is
// faked, so these mocks are only needed to satisfy the static imports.
jest.mock('src/appointment/schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('src/appointment/schemas/appointment-assignment-task.schema', () => ({ AppointmentAssignmentTask: class AppointmentAssignmentTask {} }));
jest.mock('src/payment/schemas/payment.schema', () => ({ Payment: class Payment {} }));
jest.mock('src/visit/schemas/visit.schema', () => ({ Visit: class Visit {} }));
jest.mock('src/patient/schema/medical-record.schema', () => ({ MedicalEncounter: class MedicalEncounter {} }));
jest.mock('src/billing/billing.schema', () => ({ Billing: class Billing {} }));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({ TimeSlotLog: class TimeSlotLog {} }));
jest.mock('src/wallet/credit/schemas/credit-transaction.schema', () => ({ CreditTransaction: class CreditTransaction {} }));
jest.mock('src/wallet/coin/schemas/coin-transaction.schema', () => ({ CoinTransaction: class CoinTransaction {} }));
jest.mock('src/notification/schemas/notification.schema', () => ({ Notification: class Notification {} }));
jest.mock('src/doctor/schema/doctor.schema', () => ({ Doctor: class Doctor {} }));
jest.mock('src/patient/schema/patient.schema', () => ({ Patient: class Patient {} }));
jest.mock('src/account/schemas/account.schema', () => ({ Account: class Account {} }));

import { NotFoundException } from '@nestjs/common';
import { WarningCode } from '../enums/warning.enums';
import { LifecycleDetailService, sanitizeSnapshot } from './lifecycle-detail.service';

function fakeLifecycle(bundle: any, tree: any) {
  return { getBundleAndTree: jest.fn().mockResolvedValue({ appointment: bundle.appointment, bundle, tree }) } as any;
}

const bundle = {
  appointment: { _id: 'appt1', appointmentStatus: 'PENDING', patientEmail: 'p@e.com', phone: '0900000000', address: '123 Secret St' },
  visit: null,
  depositPayments: [],
  billingPayments: [],
  assignmentTasks: [],
  encounter: null,
  billing: null,
  timeSlot: null,
  creditTransactions: [],
  coinTransactions: [],
  notifications: [],
  lookups: { doctors: new Map(), patients: new Map(), accounts: new Map(), receptionists: new Map() },
};

const tree = {
  nodes: [
    { id: 'N1', phase: 'BOOKING', eventType: 'APPOINTMENT_CREATED', timestamp: 500, statusAfter: 'PENDING', actor: { actorType: 'UNKNOWN' }, sourceCollection: 'appointments', sourceRecordId: 'appt1', warnings: [] },
    { id: 'N2', phase: 'VISIT', eventType: 'VISIT_CREATED', timestamp: null, actor: { actorType: 'UNKNOWN' }, sourceCollection: 'visits', sourceRecordId: 'ghost', warnings: [] },
  ],
};

describe('LifecycleDetailService', () => {
  it('returns a sanitized snapshot for a known node (phone/address redacted)', async () => {
    const service = new LifecycleDetailService(fakeLifecycle(bundle, tree));
    const res = await service.getNodeDetail('appt1', 'N1');
    expect(res.code).toBe('SUCCESS');
    expect(res.data!.complete).toBe(true);
    expect(res.data!.domainSnapshot.appointmentStatus).toBe('PENDING');
    expect(res.data!.domainSnapshot.phone).toBe('[redacted]');
    expect(res.data!.domainSnapshot.address).toBe('[redacted]');
  });

  it('throws 404 for an unknown node id', async () => {
    const service = new LifecycleDetailService(fakeLifecycle(bundle, tree));
    await expect(service.getNodeDetail('appt1', 'NOPE')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns a partial (complete=false) detail with a warning when the source record is gone', async () => {
    const service = new LifecycleDetailService(fakeLifecycle(bundle, tree));
    const res = await service.getNodeDetail('appt1', 'N2');
    expect(res.code).toBe('SUCCESS');
    expect(res.data!.complete).toBe(false);
    expect(res.data!.warnings.some((w) => w.code === WarningCode.NODE_DETAIL_INCOMPLETE)).toBe(true);
  });
});

describe('sanitizeSnapshot', () => {
  it('redacts sensitive keys and summarizes heavy arrays', () => {
    const out = sanitizeSnapshot({
      _id: 'x',
      status: 'OK',
      phone: '123',
      prescriptions: [1, 2, 3],
      createdAt: new Date(10),
      __v: 7,
    });
    expect(out.status).toBe('OK');
    expect(out.phone).toBe('[redacted]');
    expect(out.prescriptions).toEqual({ count: 3 });
    expect(out.createdAt).toBe(10);
    expect(out.__v).toBeUndefined();
  });
});
