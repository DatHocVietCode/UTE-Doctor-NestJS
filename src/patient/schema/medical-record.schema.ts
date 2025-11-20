import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { BloodType } from "src/common/enum/blood-type.enum";


export type VitalSignRecordDocument = HydratedDocument<VitalSignRecord>;
@Schema()
export class VitalSignRecord {
  @Prop({ type: Number, required: false })
  value?: number;

  @Prop({ type: Object, required: false })
  bloodPressure?: { systolic: number; diastolic: number };

  @Prop({ type: Date, required: true })
  dateRecord: Date;
}
export const VitalSignRecordSchema = SchemaFactory.createForClass(VitalSignRecord);

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
  bloodPressure: VitalSignRecord[];

  @Prop({ type: [VitalSignRecordSchema], default: [] })
  heartRate: VitalSignRecord[];
}
export const MedicalRecordSchema = SchemaFactory.createForClass(MedicalRecord);