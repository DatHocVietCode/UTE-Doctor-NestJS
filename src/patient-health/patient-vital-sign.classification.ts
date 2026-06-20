import { HealthMetricStatus, OverallHealthStatus } from './enums/patient-vital-sign.enums';

// Backend owns ALL clinical classification and thresholds. Conservative adult cutoffs (MVP):
// no age/sex/condition rules. The FE must never reimplement these.

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// BMI = kg / m^2, rounded to 1 decimal place. Only derivable when height AND weight are valid.
export function computeBmi(heightCm?: number, weightKg?: number): number | undefined {
  if (!isPositiveNumber(heightCm) || !isPositiveNumber(weightKg)) {
    return undefined;
  }
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  return Math.round(bmi * 10) / 10;
}

export function classifyBmi(bmi?: number): HealthMetricStatus | undefined {
  if (!isFiniteNumber(bmi)) return undefined;
  if (bmi < 18.5) return HealthMetricStatus.LOW;
  if (bmi >= 25) return HealthMetricStatus.HIGH;
  return HealthMetricStatus.NORMAL;
}

// Blood pressure is atomic: classified only when both values are present.
export function classifyBloodPressure(
  systolic?: number,
  diastolic?: number,
): HealthMetricStatus | undefined {
  if (!isFiniteNumber(systolic) || !isFiniteNumber(diastolic)) return undefined;
  if (systolic < 90 || diastolic < 60) return HealthMetricStatus.LOW;
  if (systolic >= 140 || diastolic >= 90) return HealthMetricStatus.HIGH;
  return HealthMetricStatus.NORMAL;
}

export function classifyHeartRate(bpm?: number): HealthMetricStatus | undefined {
  if (!isFiniteNumber(bpm)) return undefined;
  if (bpm < 60) return HealthMetricStatus.LOW;
  if (bpm > 100) return HealthMetricStatus.HIGH;
  return HealthMetricStatus.NORMAL;
}

export interface ClassifiableStatus {
  bmi?: HealthMetricStatus;
  bloodPressure?: HealthMetricStatus;
  heartRate?: HealthMetricStatus;
}

// Aggregation precedence (from the latest ACTIVE record):
//   1. no measured classifiable metric        -> UNEVALUATED
//   2. any metric LOW or HIGH                  -> NEEDS_ATTENTION  (abnormal never masked)
//   3. otherwise any metric UNKNOWN/missing    -> UNEVALUATED
//   4. otherwise every metric NORMAL           -> STABLE
export function computeOverallStatus(status?: ClassifiableStatus | null): OverallHealthStatus {
  if (!status) return OverallHealthStatus.UNEVALUATED;

  const values = [status.bmi, status.bloodPressure, status.heartRate].filter(
    (v): v is HealthMetricStatus => !!v,
  );

  if (values.length === 0) return OverallHealthStatus.UNEVALUATED;
  if (values.some((v) => v === HealthMetricStatus.LOW || v === HealthMetricStatus.HIGH)) {
    return OverallHealthStatus.NEEDS_ATTENTION;
  }
  if (values.some((v) => v === HealthMetricStatus.UNKNOWN)) {
    return OverallHealthStatus.UNEVALUATED;
  }
  return OverallHealthStatus.STABLE;
}
