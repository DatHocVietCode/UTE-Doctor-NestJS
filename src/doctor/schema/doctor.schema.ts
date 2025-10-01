import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { Account } from "src/account/schemas/account.schema";

export type DoctorDocument = HydratedDocument<Doctor>;
@Schema()
export class Doctor {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Account.name, required: true })
  accountId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  specialty: string;

  @Prop()
  degree: string;

  @Prop()
  yearsOfExperience: number;

  @Prop([String])
  availableTimes: string[]; // lịch khám
}
export const DoctorSchema = SchemaFactory.createForClass(Doctor);
