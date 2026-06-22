import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument, Types } from 'mongoose';
import { BloodType } from 'src/common/enum/blood-type.enum';
import {
  HealthMetricStatus,
  MeasuredByRole,
  VitalSignRecordState,
  VitalSignSource,
} from '../enums/patient-vital-sign.enums';

// Backend-owned metric statuses. `weight` is reserved but NOT populated in MVP.
@Schema({ _id: false })
export class VitalSignStatus {
  @Prop({ enum: HealthMetricStatus }) bmi?: HealthMetricStatus;
  @Prop({ enum: HealthMetricStatus }) bloodPressure?: HealthMetricStatus;
  @Prop({ enum: HealthMetricStatus }) heartRate?: HealthMetricStatus;
  @Prop({ enum: HealthMetricStatus }) weight?: HealthMetricStatus;
}
export const VitalSignStatusSchema = SchemaFactory.createForClass(VitalSignStatus);

// Denormalized snapshot of who measured (resolved from the JWT at write time).
@Schema({ _id: false })
export class MeasuredBy {
  @Prop({ required: true }) id!: string;
  @Prop() name?: string;
  @Prop({ enum: MeasuredByRole, required: true }) role!: MeasuredByRole;
}
export const MeasuredBySchema = SchemaFactory.createForClass(MeasuredBy);

// Reserved for future correction/void flows (see ADR-0002).
@Schema({ _id: false })
export class CorrectedBy {
  @Prop({ required: true }) id!: string;
  @Prop({ enum: MeasuredByRole, required: true }) role!: MeasuredByRole;
}
export const CorrectedBySchema = SchemaFactory.createForClass(CorrectedBy);

export type PatientVitalSignDocument = HydratedDocument<PatientVitalSign>;

// Standalone, append-only clinical vital-sign snapshot (see ADR-0001).
@Schema({ timestamps: true, collection: 'patientvitalsigns' })
export class PatientVitalSign {
  _id!: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true })
  patientId!: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' })
  appointmentId?: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Visit', index: true })
  visitId?: Types.ObjectId;

  @Prop({ enum: BloodType })
  bloodType?: BloodType;

  @Prop() heightCm?: number;
  @Prop() weightKg?: number;
  // Backend-derived. Never accepted from clients.
  @Prop() bmi?: number;

  @Prop() bloodPressureSystolic?: number;
  @Prop() bloodPressureDiastolic?: number;
  @Prop() heartRateBpm?: number;

  @Prop({ type: VitalSignStatusSchema })
  status?: VitalSignStatus;

  @Prop({ enum: VitalSignSource, required: true, default: VitalSignSource.RECEPTIONIST_CHECK_IN })
  source!: VitalSignSource;

  @Prop({ enum: VitalSignRecordState, required: true, default: VitalSignRecordState.ACTIVE, index: true })
  recordState!: VitalSignRecordState;

  // When the measurement physically occurred (epoch ms UTC).
  @Prop({ required: true })
  measuredAt!: number;

  @Prop({ type: MeasuredBySchema })
  measuredBy?: MeasuredBy;

  @Prop() note?: string;

  // --- Reserved correction/void audit fields (no mutating endpoint in MVP; see ADR-0002) ---
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'PatientVitalSign' })
  supersedesRecordId?: Types.ObjectId;
  @Prop() correctionReason?: string;
  @Prop({ type: CorrectedBySchema })
  correctedBy?: CorrectedBy;

  // Provided by { timestamps: true }.
  createdAt?: Date;
  updatedAt?: Date;
}

export const PatientVitalSignSchema = SchemaFactory.createForClass(PatientVitalSign);
// Drives the summary query: latest ACTIVE records for a patient, newest first.
PatientVitalSignSchema.index({ patientId: 1, recordState: 1, measuredAt: -1, createdAt: -1 });
