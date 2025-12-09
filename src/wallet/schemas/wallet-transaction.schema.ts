import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type WalletTransactionDocument = HydratedDocument<WalletTransaction>;

@Schema({ timestamps: true })
export class WalletTransaction {
  _id: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true })
  patientId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' })
  appointmentId?: mongoose.Types.ObjectId;

  @Prop({ enum: ['earn', 'spend'], required: true })
  type: 'earn' | 'spend'; // earn: hoãn/hủy, spend: thanh toán

  @Prop({ required: true, min: 0 })
  amount: number; // Số coin

  @Prop({ required: true })
  reason: string; // appointment_reschedule, appointment_cancel, appointment_booking, etc

  @Prop()
  description?: string; // Mô tả chi tiết (e.g., "Hoãn từ 14h thành 16h")

  @Prop({ default: 'completed' })
  status: 'pending' | 'completed' | 'failed';

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const WalletTransactionSchema = SchemaFactory.createForClass(WalletTransaction);

// Indexes để query nhanh
WalletTransactionSchema.index({ patientId: 1, createdAt: -1 });
WalletTransactionSchema.index({ patientId: 1, type: 1 });
WalletTransactionSchema.index({ appointmentId: 1 });
