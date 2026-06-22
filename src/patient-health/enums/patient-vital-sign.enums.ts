// Provenance of a vital-sign record. MVP only emits RECEPTIONIST_CHECK_IN; the rest are
// reserved for future flows (see api-contract/README_PATIENT_HEALTH_DASHBOARD.md).
export enum VitalSignSource {
  RECEPTIONIST_CHECK_IN = 'RECEPTIONIST_CHECK_IN',
  VISIT_INTAKE = 'VISIT_INTAKE',
  MIGRATED = 'MIGRATED',
  UNKNOWN = 'UNKNOWN',
}

// Append-only lifecycle. Only ACTIVE records feed the patient health summary (see ADR-0002).
export enum VitalSignRecordState {
  ACTIVE = 'ACTIVE',
  SUPERSEDED = 'SUPERSEDED',
  VOIDED = 'VOIDED',
}

// Backend-owned per-metric clinical classification. The FE never computes thresholds.
export enum HealthMetricStatus {
  NORMAL = 'NORMAL',
  LOW = 'LOW',
  HIGH = 'HIGH',
  UNKNOWN = 'UNKNOWN',
}

// Backend-owned summary-level roll-up across the latest ACTIVE record's metrics.
export enum OverallHealthStatus {
  STABLE = 'STABLE',
  NEEDS_ATTENTION = 'NEEDS_ATTENTION',
  UNEVALUATED = 'UNEVALUATED',
}

// Role of whoever recorded/corrected a measurement. MVP only emits RECEPTIONIST.
export enum MeasuredByRole {
  RECEPTIONIST = 'RECEPTIONIST',
  DOCTOR = 'DOCTOR',
  NURSE = 'NURSE',
  SYSTEM = 'SYSTEM',
}
