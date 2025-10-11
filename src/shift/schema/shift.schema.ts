import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { Doctor } from "../../doctor/schema/doctor.schema";
import { Patient } from "src/patient/schema/patient.schema";

export type ShiftDocument = HydratedDocument<Shift>;

@Schema()
export class Shift {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Doctor.name, required: true })
  doctorId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Patient.name, required: true })
  patientId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  date: string; // "2025-10-05" (YYYY-MM-DD)

  @Prop({ required: true })
  shift: "morning" | "afternoon" | "extra";

  @Prop({ default: "available" })
  status: "available" | "hasClient" | "completed";
}

export const ShiftSchema = SchemaFactory.createForClass(Shift);
