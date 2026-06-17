// Schemas can't be imported under ts-jest (decorator metadata is stripped), so mock
// every schema module the service pulls in. The service is constructed directly with
// fake models, so the mocked classes are only needed to satisfy the imports.
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
import { AppointmentLifecycleService } from './appointment-lifecycle.service';

const VALID_ID = '64c000000000000000000001';

function okQuery(val: any) {
  const c: any = {};
  c.sort = () => c;
  c.skip = () => c;
  c.limit = () => c;
  c.lean = () => c;
  c.select = () => c;
  c.exec = () => Promise.resolve(val);
  return c;
}
function failQuery() {
  const c: any = {};
  c.sort = () => c;
  c.skip = () => c;
  c.limit = () => c;
  c.lean = () => c;
  c.select = () => c;
  c.exec = () => Promise.reject(new Error('boom'));
  return c;
}
function fakeModel(cfg: { find?: () => any; findOne?: () => any; findById?: () => any; count?: number } = {}) {
  return {
    find: jest.fn(() => (cfg.find ? cfg.find() : okQuery([]))),
    findOne: jest.fn(() => (cfg.findOne ? cfg.findOne() : okQuery(null))),
    findById: jest.fn(() => (cfg.findById ? cfg.findById() : okQuery(null))),
    countDocuments: jest.fn(() => ({ exec: () => Promise.resolve(cfg.count ?? 0) })),
  } as any;
}

interface Models {
  appt?: any; task?: any; payment?: any; visit?: any; encounter?: any; billing?: any;
  slot?: any; credit?: any; coin?: any; notification?: any; doctor?: any; patient?: any; account?: any;
}
function makeService(m: Models = {}) {
  return new AppointmentLifecycleService(
    m.appt ?? fakeModel(),
    m.task ?? fakeModel(),
    m.payment ?? fakeModel(),
    m.visit ?? fakeModel(),
    m.encounter ?? fakeModel(),
    m.billing ?? fakeModel(),
    m.slot ?? fakeModel(),
    m.credit ?? fakeModel(),
    m.coin ?? fakeModel(),
    m.notification ?? fakeModel(),
    m.doctor ?? fakeModel(),
    m.patient ?? fakeModel(),
    m.account ?? fakeModel(),
  );
}

const baseAppt = {
  _id: VALID_ID,
  appointmentStatus: 'CONFIRMED',
  assignmentStatus: 'NONE',
  paymentCategory: 'BHYT',
  depositStatus: 'NOT_REQUIRED',
  createdAt: new Date(500),
  bookingDate: 500,
};

describe('AppointmentLifecycleService', () => {
  describe('getLifecycle', () => {
    it('throws 404 for an invalid appointment id', async () => {
      const service = makeService();
      await expect(service.getLifecycle('not-an-id')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when the root appointment is missing', async () => {
      const service = makeService({ appt: fakeModel({ findById: () => okQuery(null) }) });
      await expect(service.getLifecycle(VALID_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns a SUCCESS lifecycle tree for an existing appointment', async () => {
      const service = makeService({ appt: fakeModel({ findById: () => okQuery(baseAppt) }) });
      const res = await service.getLifecycle(VALID_ID);
      expect(res.code).toBe('SUCCESS');
      expect(res.data!.rootNodeId).toBeTruthy();
      expect(res.data!.appointment.id).toBe(VALID_ID);
    });

    it('does not crash the whole tree when one branch query fails (isolation)', async () => {
      const service = makeService({
        appt: fakeModel({ findById: () => okQuery(baseAppt) }),
        visit: fakeModel({ findOne: () => failQuery() }),
      });
      const res = await service.getLifecycle(VALID_ID);
      expect(res.code).toBe('SUCCESS');
      expect(res.data!.reconstruction.partial).toBe(true);
    });
  });

  describe('listAppointments', () => {
    it('returns paginated summaries with visit/billing rollups', async () => {
      const service = makeService({
        appt: fakeModel({ find: () => okQuery([{ _id: VALID_ID, appointmentStatus: 'CONFIRMED', patientEmail: 'p@e.com', bookingDate: 500, scheduledAt: 5000 }]), count: 1 }),
      });
      const res = await service.listAppointments({ page: 1, limit: 20 } as any);
      expect(res.code).toBe('SUCCESS');
      expect(res.data!.total).toBe(1);
      expect(res.data!.items).toHaveLength(1);
      expect(res.data!.items[0].appointmentId).toBe(VALID_ID);
    });
  });
});
