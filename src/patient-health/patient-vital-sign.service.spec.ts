jest.mock('./schemas/patient-vital-sign.schema', () => ({
  PatientVitalSign: class PatientVitalSign {},
}));
jest.mock('src/appointment/schemas/appointment.schema', () => ({
  Appointment: class Appointment {},
}));
jest.mock('src/profile/schema/profile.schema', () => ({ Profile: class Profile {} }));
jest.mock('src/visit/visit.service', () => ({ VisitService: class VisitService {} }));

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { VisitStatus } from 'src/visit/enums/visit-status.enum';
import {
  HealthMetricStatus,
  OverallHealthStatus,
  VitalSignRecordState,
  VitalSignSource,
} from './enums/patient-vital-sign.enums';
import { PatientVitalSignService } from './patient-vital-sign.service';

function leanChain(value: any) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }),
    }),
  };
}

function buildService(options: {
  visit?: any;
  scheduledAt?: number;
  profileName?: string;
} = {}) {
  const visit =
    options.visit === undefined
      ? {
          _id: new Types.ObjectId(),
          patientId: new Types.ObjectId(),
          appointmentId: new Types.ObjectId(),
          status: VisitStatus.CHECKED_IN,
        }
      : options.visit;

  const vitalSignModel: any = {
    create: jest.fn().mockImplementation(async (doc: any) => ({
      _id: new Types.ObjectId(),
      createdAt: new Date(),
      ...doc,
    })),
    find: jest.fn(),
  };

  const appointmentModel: any = {
    findById: jest.fn().mockReturnValue(
      leanChain({ scheduledAt: options.scheduledAt ?? Date.now() }),
    ),
  };

  const profileModel: any = {
    findById: jest.fn().mockReturnValue(leanChain({ name: options.profileName ?? 'Le Tan' })),
  };

  const visitService: any = { getVisitById: jest.fn().mockResolvedValue(visit) };

  const service = new PatientVitalSignService(
    vitalSignModel,
    appointmentModel,
    profileModel,
    visitService,
  );

  return { service, vitalSignModel, appointmentModel, profileModel, visitService, visit };
}

const receptionist = {
  accountId: new Types.ObjectId().toString(),
  profileId: new Types.ObjectId().toString(),
  role: 'RECEPTIONIST',
};

describe('PatientVitalSignService.createForVisit', () => {
  it('records a vital sign deriving identity from the visit and server context', async () => {
    const { service, vitalSignModel, visit } = buildService();

    const result = await service.createForVisit(
      visit._id.toString(),
      { heightCm: 172, weightKg: 68, heartRateBpm: 72 },
      receptionist as any,
    );

    const persisted = vitalSignModel.create.mock.calls[0][0];
    expect(persisted.patientId).toBe(visit.patientId);
    expect(persisted.appointmentId).toBe(visit.appointmentId);
    expect(persisted.visitId).toBe(visit._id);
    expect(persisted.source).toBe(VitalSignSource.RECEPTIONIST_CHECK_IN);
    expect(persisted.recordState).toBe(VitalSignRecordState.ACTIVE);
    expect(persisted.measuredBy).toEqual({
      id: receptionist.accountId,
      name: 'Le Tan',
      role: 'RECEPTIONIST',
    });

    expect(result.vitalSign.source).toBe(VitalSignSource.RECEPTIONIST_CHECK_IN);
    expect(result.vitalSign.recordState).toBe(VitalSignRecordState.ACTIVE);
    expect(result.vitalSign.id).toBeDefined();
  });

  it('derives BMI + status and leaves omitted metrics absent', async () => {
    const { service, vitalSignModel } = buildService();

    const result = await service.createForVisit(
      new Types.ObjectId().toString(),
      { heightCm: 172, weightKg: 68 },
      receptionist as any,
    );

    const persisted = vitalSignModel.create.mock.calls[0][0];
    expect(persisted.bmi).toBe(23);
    expect(persisted.status.bmi).toBe(HealthMetricStatus.NORMAL);
    // No blood pressure / heart rate supplied -> absent, not 0 / UNKNOWN.
    expect(persisted.bloodPressureSystolic).toBeUndefined();
    expect(persisted.heartRateBpm).toBeUndefined();
    expect(persisted.status.bloodPressure).toBeUndefined();
    expect(persisted.status.heartRate).toBeUndefined();
    expect(result.vitalSign.bmi).toBe(23);
  });

  it('never populates status.weight even when weight is recorded', async () => {
    const { service, vitalSignModel } = buildService();

    await service.createForVisit(
      new Types.ObjectId().toString(),
      { weightKg: 68 },
      receptionist as any,
    );

    const persisted = vitalSignModel.create.mock.calls[0][0];
    // weight-only with no height -> no classifiable metric -> no status at all.
    expect(persisted.status).toBeUndefined();
  });

  it('rejects a payload with no actual measurement', async () => {
    const { service } = buildService();
    await expect(
      service.createForVisit(new Types.ObjectId().toString(), {}, receptionist as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a blood-type-only payload', async () => {
    const { service } = buildService();
    await expect(
      service.createForVisit(
        new Types.ObjectId().toString(),
        { bloodType: 'A' } as any,
        receptionist as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a partial blood pressure', async () => {
    const { service } = buildService();
    await expect(
      service.createForVisit(
        new Types.ObjectId().toString(),
        { bloodPressureSystolic: 120 },
        receptionist as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a future measuredAt beyond the skew allowance', async () => {
    const { service } = buildService();
    const future = Date.now() + 10 * 60 * 1000;
    await expect(
      service.createForVisit(
        new Types.ObjectId().toString(),
        { heartRateBpm: 72, measuredAt: future },
        receptionist as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a measuredAt before the visit intake window', async () => {
    const scheduledAt = Date.now();
    const { service } = buildService({ scheduledAt });
    const tooEarly = scheduledAt - 7 * 60 * 60 * 1000; // before scheduledAt - 6h
    await expect(
      service.createForVisit(
        new Types.ObjectId().toString(),
        { heartRateBpm: 72, measuredAt: tooEarly },
        receptionist as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the visit is not CHECKED_IN or IN_PROGRESS', async () => {
    const { service } = buildService({
      visit: {
        _id: new Types.ObjectId(),
        patientId: new Types.ObjectId(),
        appointmentId: new Types.ObjectId(),
        status: VisitStatus.CREATED,
      },
    });
    await expect(
      service.createForVisit(
        new Types.ObjectId().toString(),
        { heartRateBpm: 72 },
        receptionist as any,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('defaults measuredAt to server time when omitted', async () => {
    const { service, vitalSignModel } = buildService();
    const before = Date.now();
    await service.createForVisit(
      new Types.ObjectId().toString(),
      { heartRateBpm: 72 },
      receptionist as any,
    );
    const persisted = vitalSignModel.create.mock.calls[0][0];
    expect(persisted.measuredAt).toBeGreaterThanOrEqual(before);
    expect(persisted.measuredAt).toBeLessThanOrEqual(Date.now());
  });
});

describe('PatientVitalSignService.getHealthSummaryForAccount', () => {
  it('throws PATIENT_NOT_FOUND when the JWT carries no patientId', async () => {
    const { service } = buildService();

    expect.assertions(2);
    try {
      await service.getHealthSummaryForAccount({ accountId: 'acc-1' } as any);
    } catch (error: any) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.getResponse()).toMatchObject({
        code: ResponseCode.PATIENT_NOT_FOUND,
        data: null,
      });
    }
  });

  it('returns a 200-style empty summary when there are no measurements', async () => {
    const { service, vitalSignModel } = buildService();
    const patientId = new Types.ObjectId().toString();
    vitalSignModel.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    });

    const res = await service.getHealthSummaryForAccount({ accountId: 'acc-1', patientId } as any);

    expect(res.code).toBe(ResponseCode.SUCCESS);
    expect(res.data).toMatchObject({
      patientId,
      latest: null,
      history: [],
      overallStatus: OverallHealthStatus.UNEVALUATED,
    });
    expect(typeof res.data!.generatedAt).toBe('number');
  });

  it('queries only ACTIVE records for the JWT patient and maps latest = history[0]', async () => {
    const { service, vitalSignModel } = buildService();
    const patientId = new Types.ObjectId().toString();

    const docs = [
      {
        _id: new Types.ObjectId(),
        patientId: new Types.ObjectId(),
        measuredAt: 2000,
        createdAt: new Date(2000),
        source: VitalSignSource.RECEPTIONIST_CHECK_IN,
        recordState: VitalSignRecordState.ACTIVE,
        status: { bloodPressure: HealthMetricStatus.NORMAL, heartRate: HealthMetricStatus.NORMAL },
        bloodPressureSystolic: 118,
        bloodPressureDiastolic: 76,
        heartRateBpm: 72,
      },
      {
        _id: new Types.ObjectId(),
        patientId: new Types.ObjectId(),
        measuredAt: 1000,
        createdAt: new Date(1000),
        source: VitalSignSource.RECEPTIONIST_CHECK_IN,
        recordState: VitalSignRecordState.ACTIVE,
      },
    ];
    const findChain = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(docs),
    };
    vitalSignModel.find.mockReturnValue(findChain);

    const res = await service.getHealthSummaryForAccount({ accountId: 'acc-1', patientId } as any);

    expect(vitalSignModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ patientId, recordState: VitalSignRecordState.ACTIVE }),
    );
    expect(findChain.sort).toHaveBeenCalledWith({ measuredAt: -1, createdAt: -1 });
    expect(res.data!.history).toHaveLength(2);
    expect(res.data!.latest).toEqual(res.data!.history[0]);
    expect(res.data!.latest!.id).toBe(docs[0]._id.toString());
    // latest record has all-NORMAL classifiable metrics -> STABLE
    expect(res.data!.overallStatus).toBe(OverallHealthStatus.STABLE);
  });

  it('clamps limit to the maximum of 50 and defaults to 10', async () => {
    const { service, vitalSignModel } = buildService();
    const patientId = new Types.ObjectId().toString();
    const findChain = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    vitalSignModel.find.mockReturnValue(findChain);

    await service.getHealthSummaryForAccount({ accountId: 'acc-1', patientId } as any, 999);
    expect(findChain.limit).toHaveBeenCalledWith(50);

    await service.getHealthSummaryForAccount({ accountId: 'acc-1', patientId } as any, undefined);
    expect(findChain.limit).toHaveBeenLastCalledWith(10);
  });
});
