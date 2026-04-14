import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import { Doctor } from 'src/doctor/schema/doctor.schema';

export type DoctorPostDocument = HydratedDocument<DoctorPost>;

@Schema({ timestamps: true })
export class DoctorPost {
  @Prop({ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: Doctor.name, 
    required: true 
  })
  doctorId: Doctor | mongoose.Types.ObjectId;

  @Prop({ required: true })
  postLink: string;

  @Prop({ default: 0 })
  viewCount: number;

  @Prop()
  title?: string;

  @Prop()
  description?: string;

  @Prop({ default: 'ACTIVE', enum: ['ACTIVE', 'HIDDEN'] })
  status: string;
}

export const DoctorPostSchema = SchemaFactory.createForClass(DoctorPost);
