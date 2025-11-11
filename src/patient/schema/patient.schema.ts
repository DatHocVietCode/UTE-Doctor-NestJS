import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { Account } from "src/account/schemas/account.schema";
import { BloodType } from "src/common/enum/blood-type.enum";
import { MedicalRecord, MedicalRecordSchema } from "./medical-record.schema";
import { Profile } from "src/profile/schema/profile.schema";
import { Appointment } from "src/appointment/schemas/appointment.schema";

export type PatientDocument = HydratedDocument<Patient>;
@Schema()
export class Patient {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Profile.name, required: true})
  profileId: mongoose.Types.ObjectId;

  @Prop()
  height: number;

  @Prop()
  weight: number;

  @Prop({ enum: BloodType })
  bloodType: BloodType;

  @Prop({ type: MedicalRecordSchema })
  medicalRecord: MedicalRecord;

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: Appointment.name }] })
  appointments: mongoose.Types.ObjectId[];
}
export const PatientSchema = SchemaFactory.createForClass(Patient);
