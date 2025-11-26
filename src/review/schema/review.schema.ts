import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { Doctor } from "src/doctor/schema/doctor.schema";
import { Patient } from "src/patient/schema/patient.schema";


export type ReviewDocument = HydratedDocument<Review>;

@Schema({ timestamps: true })
export class Review {
  @Prop({ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: Doctor.name, 
    required: true 
  })
  doctorId: mongoose.Types.ObjectId;

  @Prop({ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: Patient.name, 
    required: true 
  })
  patientId: mongoose.Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ type: String })
  note: string;   // ghi chú / nhận xét
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
