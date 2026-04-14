import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type CreditTransactionDocument = HydratedDocument<CreditTransaction>;

@Schema({ timestamps: true })
export class CreditTransaction {
  _id: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true })
  patientId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' })
  appointmentId?: mongoose.Types.ObjectId;

  @Prop({ enum: ['credit', 'debit'], required: true })
  type: 'credit' | 'debit';

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true })
  reason: string;

  @Prop()
  description?: string;

  @Prop({ default: 'completed' })
  status: 'pending' | 'completed' | 'failed';

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const CreditTransactionSchema = SchemaFactory.createForClass(CreditTransaction);

CreditTransactionSchema.index({ patientId: 1, createdAt: -1 });
CreditTransactionSchema.index({ patientId: 1, type: 1 });
CreditTransactionSchema.index({ appointmentId: 1 });
