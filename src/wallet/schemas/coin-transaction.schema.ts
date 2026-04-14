import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type CoinTransactionDocument = HydratedDocument<CoinTransaction>;

@Schema({ timestamps: true })
export class CoinTransaction {
  _id: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true })
  patientId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' })
  appointmentId?: mongoose.Types.ObjectId;

  @Prop({ enum: ['earn', 'spend'], required: true })
  type: 'earn' | 'spend';

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true })
  reason: string;

  @Prop()
  description?: string;

  // Only earn transactions need expiration. Spend entries should not expire.
  @Prop()
  expiresAt?: Date;

  @Prop({ default: 'completed' })
  status: 'pending' | 'completed' | 'failed';

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const CoinTransactionSchema = SchemaFactory.createForClass(CoinTransaction);

CoinTransactionSchema.index({ patientId: 1, createdAt: -1 });
CoinTransactionSchema.index({ patientId: 1, type: 1 });
CoinTransactionSchema.index({ appointmentId: 1 });
CoinTransactionSchema.index({ patientId: 1, expiresAt: 1, type: 1 });
