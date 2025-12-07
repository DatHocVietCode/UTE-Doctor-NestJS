import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type WalletDocument = HydratedDocument<Wallet>;

@Schema({ timestamps: true })
export class Wallet {
  _id: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, unique: true })
  patientId: mongoose.Types.ObjectId;

  @Prop({ default: 0 })
  coinBalance: number; // Số tiền coin hiện có (có thể là 0 hoặc dương)

  @Prop({ default: 0 })
  totalCoinEarned: number; // Tổng coin đã nhận (từ refund hoặc promo)

  @Prop({ default: 0 })
  totalCoinUsed: number; // Tổng coin đã sử dụng

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);
