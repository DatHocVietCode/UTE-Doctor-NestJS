import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { VisitStatus } from '../enums/visit-status.enum';

export type VisitDocument = HydratedDocument<Visit>;

@Schema({ timestamps: true })
export class Visit {
  _id!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, unique: true })
  appointmentId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true })
  doctorId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true })
  patientId!: mongoose.Types.ObjectId;

  @Prop({ enum: VisitStatus, default: VisitStatus.CREATED })
  status!: VisitStatus;

  @Prop()
  startedAt?: number;

  @Prop()
  completedAt?: number;
}

export const VisitSchema = SchemaFactory.createForClass(Visit);
// Enforce one-to-one mapping between appointment and visit.
VisitSchema.index({ appointmentId: 1 }, { unique: true });
