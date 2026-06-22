jest.mock('./schemas/visit.schema', () => ({ Visit: class Visit {} }));
jest.mock('src/appointment/schemas/appointment.schema', () => ({
  Appointment: class Appointment {},
}));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({
  TimeSlotLog: class TimeSlotLog {},
}));
jest.mock('src/patient/schema/patient.schema', () => ({
  Patient: class Patient {},
}));
jest.mock('src/patient/medical-encounter.service', () => ({
  MedicalEncounterService: class MedicalEncounterService {},
}));
jest.mock('src/doctor/schema/doctor.schema', () => ({
  Doctor: class Doctor {},
}));
jest.mock('src/profile/schema/profile.schema', () => ({
  Profile: class Profile {},
}));

import { VisitService } from './visit.service';

function buildService(candidateScheduledAt: number) {
  let capturedPipeline: Record<string, any>[] = [];
  const candidate = {
    visitId: 'visit-1',
    appointmentId: 'appointment-1',
    scheduledAt: candidateScheduledAt,
  };
  const visitModel = {
    aggregate: jest.fn((pipeline: Record<string, any>[]) => {
      capturedPipeline = pipeline;
      const range = pipeline
        .map((stage) => stage.$match?.['appointment.scheduledAt'])
        .find(Boolean);
      const included =
        range &&
        candidateScheduledAt >= range.$gte &&
        candidateScheduledAt < range.$lt;

      return {
        exec: jest.fn().mockResolvedValue(included ? [candidate] : []),
      };
    }),
  };

  const namedModel = (name: string) => ({ collection: { name } });
  const service = new VisitService(
    { emit: jest.fn() } as any,
    visitModel as any,
    namedModel('appointments') as any,
    namedModel('time-slot-logs') as any,
    namedModel('patients') as any,
    namedModel('doctors') as any,
    namedModel('profiles') as any,
    {} as any,
  );

  return {
    service,
    getPipeline: () => capturedPipeline,
  };
}

describe('VisitService today visits timezone filtering', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-20T00:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps calls without timezone backward compatible with Vietnam local day', async () => {
    const { service, getPipeline } = buildService(
      Date.parse('2026-06-19T18:00:00.000Z'),
    );

    const visits = await service.getTodayVisitsForReceptionist();

    expect(visits).toHaveLength(1);
    const range = getPipeline()
      .map((stage) => stage.$match?.['appointment.scheduledAt'])
      .find(Boolean);
    expect(range).toEqual({
      $gte: Date.parse('2026-06-19T17:00:00.000Z'),
      $lt: Date.parse('2026-06-20T17:00:00.000Z'),
    });
  });

  it('includes a visit near UTC midnight that belongs to the Vietnam local day', async () => {
    const { service } = buildService(Date.parse('2026-06-19T18:00:00.000Z'));

    await expect(
      service.getTodayVisitsForDoctor(
        '64d000000000000000000002',
        'Asia/Ho_Chi_Minh',
      ),
    ).resolves.toHaveLength(1);
  });

  it('falls back to Vietnam time for an invalid timezone', async () => {
    const { service } = buildService(Date.parse('2026-06-19T18:00:00.000Z'));

    await expect(
      service.getTodayVisitsForReceptionist('Not/A_Timezone'),
    ).resolves.toHaveLength(1);
  });
});
