import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument, Types } from 'mongoose';

export enum BillingStatus {
  DRAFT = 'DRAFT',
  FINALIZED = 'FINALIZED',
  PAID = 'PAID',
}

@Schema({ timestamps: true })
export class Billing {
  _id!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Visit', required: true, unique: true })
  visitId!: Types.ObjectId;

  @Prop({ type: Number, default: 0 })
  consultationFee!: number;

  @Prop({ type: Number, default: 0 })
  medicationFee!: number;

  @Prop({ type: Number, default: 0 })
  totalAmount!: number;

  @Prop({ type: Number, default: 0 })
  insuranceAmount!: number;

  @Prop({ type: Number, default: 0 })
  depositUsed!: number;

  @Prop({ type: Number, default: 0 })
  creditUsed!: number;

  @Prop({ type: Number, default: 0 })
  coinUsed!: number;

  @Prop({ type: Number, default: 0 })
  finalPayable!: number;

  @Prop({ enum: BillingStatus, default: BillingStatus.DRAFT })
  status!: BillingStatus;
}

export type BillingDocument = HydratedDocument<Billing>;
export const BillingSchema = SchemaFactory.createForClass(Billing);
