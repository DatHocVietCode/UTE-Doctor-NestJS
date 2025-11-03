import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { Doctor } from "../../doctor/schema/doctor.schema";
import { TimeSlotLog } from "src/timeslot/schemas/timeslot-log.schema";

export type ShiftDocument = HydratedDocument<Shift>;

@Schema()
export class Shift {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Doctor.name, required: true })
  doctorId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  date: string; // "2025-10-05"

  @Prop({ type: String, enum: ["morning", "afternoon", "extra"], required: true })
  shift: "morning" | "afternoon" | "extra";

  @Prop({ type: String, enum: ["available", "hasClient", "completed", "canceled"], default: "available" })
  status: "available" | "hasClient" | "completed" | "canceled";

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: TimeSlotLog.name }],
    required: true,
    default: [],
  })
  timeSlots: mongoose.Types.ObjectId[];

  @Prop({ type: String, default: null })
  reasonForCancellation?: string | null;
}

export const ShiftSchema = SchemaFactory.createForClass(Shift);
ShiftSchema.index({ doctorId: 1, date: 1 });
