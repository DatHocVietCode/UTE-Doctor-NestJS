import { PatientVitalSignRecordDto } from './dto/patient-health-summary.dto';
import { PatientVitalSignDocument } from './schemas/patient-vital-sign.schema';

function numOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toEpochMs(value: unknown): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

// Returns only the populated status keys; undefined when nothing is classified.
// `weight` is intentionally never emitted in MVP.
function pruneStatus(status: any): PatientVitalSignRecordDto['status'] | undefined {
  if (!status) return undefined;
  const result: NonNullable<PatientVitalSignRecordDto['status']> = {};
  if (status.bmi) result.bmi = status.bmi;
  if (status.bloodPressure) result.bloodPressure = status.bloodPressure;
  if (status.heartRate) result.heartRate = status.heartRate;
  return Object.keys(result).length ? result : undefined;
}

export function mapVitalSignToDto(
  doc: PatientVitalSignDocument | Record<string, any>,
): PatientVitalSignRecordDto {
  const d = doc as any;
  return {
    id: d._id.toString(),
    patientId: d.patientId?.toString(),
    appointmentId: d.appointmentId ? d.appointmentId.toString() : undefined,
    visitId: d.visitId ? d.visitId.toString() : undefined,

    bloodType: d.bloodType ?? undefined,
    heightCm: numOrUndefined(d.heightCm),
    weightKg: numOrUndefined(d.weightKg),
    bmi: numOrUndefined(d.bmi),

    bloodPressureSystolic: numOrUndefined(d.bloodPressureSystolic),
    bloodPressureDiastolic: numOrUndefined(d.bloodPressureDiastolic),
    heartRateBpm: numOrUndefined(d.heartRateBpm),

    status: pruneStatus(d.status),

    source: d.source,
    recordState: d.recordState,

    measuredAt: d.measuredAt,

    measuredBy: d.measuredBy
      ? { id: d.measuredBy.id, name: d.measuredBy.name ?? undefined, role: d.measuredBy.role }
      : undefined,

    note: d.note ?? undefined,

    supersedesRecordId: d.supersedesRecordId ? d.supersedesRecordId.toString() : undefined,
    correctionReason: d.correctionReason ?? undefined,
    correctedBy: d.correctedBy ? { id: d.correctedBy.id, role: d.correctedBy.role } : undefined,

    createdAt: toEpochMs(d.createdAt) ?? d.measuredAt,
    updatedAt: toEpochMs(d.updatedAt),
  };
}
