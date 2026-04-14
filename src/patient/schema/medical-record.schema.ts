import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument, Types } from "mongoose";
import { BloodType } from "src/common/enum/blood-type.enum";
import { RoleEnum } from "src/common/enum/role.enum";

export enum AllergyType {
  DRUG = 'DRUG',
  FOOD = 'FOOD',
}

export enum RecordSource {
  PATIENT = 'PATIENT',
  DOCTOR = 'DOCTOR',
}

export enum ConditionStatus {
  ONGOING = 'ONGOING',
  RESOLVED = 'RESOLVED',
}

export enum VitalSignType {
  BP = 'BP',
  HR = 'HR',
  TEMP = 'TEMP',
  SPO2 = 'SPO2',
}

// Patient-level profile (slow-changing)
@Schema({ timestamps: true })
export class MedicalProfile {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true })
  patientId: Types.ObjectId;

  @Prop()
  height?: number;

  @Prop()
  weight?: number;

  @Prop({ enum: BloodType })
  bloodType?: BloodType;

  @Prop({ enum: RoleEnum, required: true, default: RoleEnum.PATIENT })
  createdByRole: RoleEnum;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Account' })
  createdByAccountId?: Types.ObjectId;
}
export type MedicalProfileDocument = HydratedDocument<MedicalProfile>;
export const MedicalProfileSchema = SchemaFactory.createForClass(MedicalProfile);

// Allergy record (drug/food), reported by patient or doctor, doctor-verifiable
@Schema({ timestamps: true })
export class AllergyRecord {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true })
  patientId: Types.ObjectId;

  @Prop({ enum: AllergyType, required: true })
  type: AllergyType;

  @Prop({ type: String, required: true })
  substance: string;

  @Prop({ type: String })
  reaction?: string;

  @Prop({ type: String })
  severity?: string;

  @Prop({ enum: RecordSource, required: true, default: RecordSource.PATIENT })
  reportedBy: RecordSource;

  @Prop({ type: Boolean, default: false })
  verifiedByDoctor: boolean;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' })
  verifiedByDoctorId?: Types.ObjectId;

  @Prop({ enum: RoleEnum, required: true })
  createdByRole: RoleEnum;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Account' })
  createdByAccountId?: Types.ObjectId;
}
export type AllergyRecordDocument = HydratedDocument<AllergyRecord>;
export const AllergyRecordSchema = SchemaFactory.createForClass(AllergyRecord);

// Longitudinal medical history (conditions)
@Schema({ timestamps: true })
export class MedicalHistoryRecord {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true })
  patientId: Types.ObjectId;

  @Prop({ type: String, required: true })
  conditionName: string;

  @Prop({ type: String })
  diagnosisCode?: string;

  @Prop({ type: Date })
  diagnosedAt?: Date;

  @Prop({ enum: ConditionStatus, required: true, default: ConditionStatus.ONGOING })
  status: ConditionStatus;

  @Prop({ enum: RecordSource, required: true, default: RecordSource.PATIENT })
  source: RecordSource;

  @Prop({ type: Boolean, default: false })
  verifiedByDoctor?: boolean;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' })
  verifiedByDoctorId?: Types.ObjectId;

  @Prop({ enum: RoleEnum, required: true })
  createdByRole: RoleEnum;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Account' })
  createdByAccountId?: Types.ObjectId;
}
export type MedicalHistoryRecordDocument = HydratedDocument<MedicalHistoryRecord>;
export const MedicalHistoryRecordSchema = SchemaFactory.createForClass(MedicalHistoryRecord);

// Vital signs (extensible), can be tied to an appointment or standalone
@Schema({ timestamps: true })
export class VitalSignRecord {
  @Prop({ enum: VitalSignType, required: true })
  type: VitalSignType;

  @Prop({ type: Number })
  value?: number;

  @Prop({ type: Object })
  bloodPressure?: { systolic: number; diastolic: number };

  @Prop({ type: Date, required: true })
  dateRecord: Date;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' })
  appointmentId?: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true })
  patientId: Types.ObjectId;

  @Prop({ enum: RoleEnum, required: true })
  createdByRole: RoleEnum;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Account' })
  createdByAccountId?: Types.ObjectId;
}
export type VitalSignRecordDocument = HydratedDocument<VitalSignRecord>;
export const VitalSignRecordSchemaV2 = SchemaFactory.createForClass(VitalSignRecord);

// Encounter/visit record (per appointment), immutable once created
@Schema({ timestamps: true })
export class MedicalEncounter {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, unique: true })
  appointmentId: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true })
  patientId: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' })
  createdByDoctorId?: Types.ObjectId;

  @Prop({ type: String, required: true })
  diagnosis: string;

  @Prop({ type: String })
  note?: string;

  @Prop({ enum: RoleEnum, required: true, default: RoleEnum.DOCTOR })
  createdByRole: RoleEnum;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Account' })
  createdByAccountId?: Types.ObjectId;

  @Prop({
    type: [
      {
        medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: false },
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        note: { type: String, required: false },
        _id: false,
      }
    ],
    default: [],
  })
  prescriptions: Array<{
    medicineId?: Types.ObjectId;
    name: string;
    quantity: number;
    note?: string;
  }>;

  @Prop({ type: [VitalSignRecordSchemaV2], default: [] })
  vitalSigns: VitalSignRecord[];

  @Prop({ type: Date, required: true })
  dateRecord: Date;
}
export type MedicalEncounterDocument = HydratedDocument<MedicalEncounter>;
export const MedicalEncounterSchema = SchemaFactory.createForClass(MedicalEncounter);

// Legacy embedded structures kept for backward compatibility during transition
export type LegacyVitalSignRecordDocument = HydratedDocument<LegacyVitalSignRecord>;
@Schema()
export class LegacyVitalSignRecord {
  @Prop({ type: Number, required: false })
  value?: number;

  @Prop({ type: Object, required: false })
  bloodPressure?: { systolic: number; diastolic: number };

  @Prop({ type: Date, required: true })
  dateRecord: Date;
}
export const VitalSignRecordSchema = SchemaFactory.createForClass(LegacyVitalSignRecord);

export type MedicalRecordDescriptionDocument = HydratedDocument<MedicalRecordDescription>;
@Schema()
export class MedicalRecordDescription {
  @Prop({ required: true })
  diagnosis: string;

  @Prop({
    type: [
      {
        medicineId: { type: mongoose.Schema.Types.ObjectId, required: false },
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        note: { type: String, required: false },
        _id: false,
      }
    ],
    default: []
  })
  prescriptions: Array<{
    medicineId: mongoose.Types.ObjectId;
    name: string;
    quantity: number;
  }>;

  @Prop({ type: String })
  note: string;

  @Prop({ type: Date, required: true })
  dateRecord: Date;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true })
  appointmentId: mongoose.Types.ObjectId;
}
export const MedicalRecordDescriptionSchema = SchemaFactory.createForClass(MedicalRecordDescription);

export type MedicalRecordDocument = HydratedDocument<MedicalRecord>;
@Schema()
export class MedicalRecord {
  @Prop()
  height: number;

  @Prop()
  weight: number;

  @Prop({ enum: BloodType })
  bloodType: BloodType;

  @Prop({ type: [MedicalRecordDescriptionSchema], default: [] })
  medicalHistory: MedicalRecordDescription[];

  @Prop({ type: [MedicalRecordDescriptionSchema], default: [] })
  drugAllergies: MedicalRecordDescription[];

  @Prop({ type: [MedicalRecordDescriptionSchema], default: [] })
  foodAllergies: MedicalRecordDescription[];

  @Prop({ type: [VitalSignRecordSchema], default: [] })
  bloodPressure: LegacyVitalSignRecord[];

  @Prop({ type: [VitalSignRecordSchema], default: [] })
  heartRate: LegacyVitalSignRecord[];
}
export const MedicalRecordSchema = SchemaFactory.createForClass(MedicalRecord);