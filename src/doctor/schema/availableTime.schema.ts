import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { Doctor } from "./doctor.schema";

export type AvailableTimeDocument = HydratedDocument<AvailableTime>;

@Schema()
export class AvailableTime {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Doctor.name, required: true })
  doctorId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  date: string; // "2025-10-05" (YYYY-MM-DD)

  @Prop({ required: true })
  shift: "morning" | "noon" | "afternoon";

  @Prop({ default: "available" })
  status: "available" | "hasClient" | "completed";
}

export const AvailableTimeSchema = SchemaFactory.createForClass(AvailableTime);
