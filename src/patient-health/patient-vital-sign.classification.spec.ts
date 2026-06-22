import { HealthMetricStatus, OverallHealthStatus } from './enums/patient-vital-sign.enums';
import {
  classifyBloodPressure,
  classifyBmi,
  classifyHeartRate,
  computeBmi,
  computeOverallStatus,
} from './patient-vital-sign.classification';

describe('computeBmi', () => {
  it('derives BMI rounded to 1 decimal place', () => {
    // 68 / 1.72^2 = 22.985 -> 23.0
    expect(computeBmi(172, 68)).toBe(23);
    // 45 / 1.6^2 = 17.578 -> 17.6
    expect(computeBmi(160, 45)).toBe(17.6);
  });

  it('is undefined unless both height and weight are positive', () => {
    expect(computeBmi(undefined, 68)).toBeUndefined();
    expect(computeBmi(172, undefined)).toBeUndefined();
    expect(computeBmi(0, 68)).toBeUndefined();
    expect(computeBmi(172, 0)).toBeUndefined();
  });
});

describe('classifyBmi', () => {
  it('applies conservative adult cutoffs at the boundaries', () => {
    expect(classifyBmi(18.4)).toBe(HealthMetricStatus.LOW);
    expect(classifyBmi(18.5)).toBe(HealthMetricStatus.NORMAL);
    expect(classifyBmi(24.9)).toBe(HealthMetricStatus.NORMAL);
    expect(classifyBmi(25)).toBe(HealthMetricStatus.HIGH);
  });

  it('is undefined when BMI is absent', () => {
    expect(classifyBmi(undefined)).toBeUndefined();
  });
});

describe('classifyBloodPressure', () => {
  it('classifies only when both values are present', () => {
    expect(classifyBloodPressure(118, undefined)).toBeUndefined();
    expect(classifyBloodPressure(undefined, 76)).toBeUndefined();
  });

  it('flags LOW / HIGH on either bound', () => {
    expect(classifyBloodPressure(118, 76)).toBe(HealthMetricStatus.NORMAL);
    expect(classifyBloodPressure(89, 70)).toBe(HealthMetricStatus.LOW);
    expect(classifyBloodPressure(120, 59)).toBe(HealthMetricStatus.LOW);
    expect(classifyBloodPressure(140, 80)).toBe(HealthMetricStatus.HIGH);
    expect(classifyBloodPressure(130, 90)).toBe(HealthMetricStatus.HIGH);
  });
});

describe('classifyHeartRate', () => {
  it('flags bradycardia / tachycardia at the boundaries', () => {
    expect(classifyHeartRate(60)).toBe(HealthMetricStatus.NORMAL);
    expect(classifyHeartRate(100)).toBe(HealthMetricStatus.NORMAL);
    expect(classifyHeartRate(59)).toBe(HealthMetricStatus.LOW);
    expect(classifyHeartRate(101)).toBe(HealthMetricStatus.HIGH);
  });

  it('is undefined when absent', () => {
    expect(classifyHeartRate(undefined)).toBeUndefined();
  });
});

describe('computeOverallStatus', () => {
  it('is UNEVALUATED with no status or no classifiable metric', () => {
    expect(computeOverallStatus(undefined)).toBe(OverallHealthStatus.UNEVALUATED);
    expect(computeOverallStatus(null)).toBe(OverallHealthStatus.UNEVALUATED);
    expect(computeOverallStatus({})).toBe(OverallHealthStatus.UNEVALUATED);
  });

  it('is STABLE when every measured metric is NORMAL', () => {
    expect(
      computeOverallStatus({
        bmi: HealthMetricStatus.NORMAL,
        bloodPressure: HealthMetricStatus.NORMAL,
        heartRate: HealthMetricStatus.NORMAL,
      }),
    ).toBe(OverallHealthStatus.STABLE);
  });

  it('is NEEDS_ATTENTION when any metric is LOW or HIGH', () => {
    expect(computeOverallStatus({ bloodPressure: HealthMetricStatus.HIGH })).toBe(
      OverallHealthStatus.NEEDS_ATTENTION,
    );
  });

  it('is UNEVALUATED when a measured metric is UNKNOWN and none are abnormal', () => {
    expect(
      computeOverallStatus({
        bmi: HealthMetricStatus.NORMAL,
        heartRate: HealthMetricStatus.UNKNOWN,
      }),
    ).toBe(OverallHealthStatus.UNEVALUATED);
  });

  it('lets an abnormal metric win over an UNKNOWN one (NEEDS_ATTENTION)', () => {
    expect(
      computeOverallStatus({
        bloodPressure: HealthMetricStatus.HIGH,
        heartRate: HealthMetricStatus.UNKNOWN,
      }),
    ).toBe(OverallHealthStatus.NEEDS_ATTENTION);
  });
});
