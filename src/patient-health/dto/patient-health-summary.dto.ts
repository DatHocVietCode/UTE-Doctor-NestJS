import {
  HealthMetricStatus,
  MeasuredByRole,
  OverallHealthStatus,
  VitalSignRecordState,
  VitalSignSource,
} from '../enums/patient-vital-sign.enums';

// Mirrors api-contract PatientVitalSignRecordDto. All timestamps are epoch milliseconds.
export interface PatientVitalSignRecordDto {
  id: string;
  patientId: string;
  appointmentId?: string;
  visitId?: string;

  bloodType?: string;
  heightCm?: number;
  weightKg?: number;
  bmi?: number;

  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRateBpm?: number;

  status?: {
    bmi?: HealthMetricStatus;
    bloodPressure?: HealthMetricStatus;
    heartRate?: HealthMetricStatus;
    weight?: HealthMetricStatus; // reserved; not populated in MVP
  };

  source: VitalSignSource;
  recordState: VitalSignRecordState;

  measuredAt: number;

  measuredBy?: {
    id: string;
    name?: string;
    role: MeasuredByRole;
  };

  note?: string;

  supersedesRecordId?: string;
  correctionReason?: string;
  correctedBy?: {
    id: string;
    role: MeasuredByRole;
  };

  createdAt: number;
  updatedAt?: number;
}

export interface PatientHealthSummaryDto {
  patientId: string;
  latest: PatientVitalSignRecordDto | null;
  history: PatientVitalSignRecordDto[];
  overallStatus: OverallHealthStatus;
  generatedAt: number;
}

export interface CreatePatientVitalSignResponseDto {
  vitalSign: PatientVitalSignRecordDto;
}
