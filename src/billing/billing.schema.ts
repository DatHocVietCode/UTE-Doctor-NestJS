import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument, Types } from 'mongoose';

export enum BillingStatus {
  DRAFT = 'DRAFT',
  FINALIZED = 'FINALIZED',
  PAID = 'PAID',
}

export enum MedicationSource {
  CLINIC = 'CLINIC',
  OUTSIDE_PURCHASE = 'OUTSIDE_PURCHASE',
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

  // Medication fulfillment snapshot for billing (financial authoritative data).
  // Snapshot at time of billing finalization to prevent future drift.
  @Prop({
    type: [
      {
        medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: false },
        medicineName: { type: String, required: true },
        prescribedQty: { type: Number, required: true },
        dispensedQty: { type: Number, required: true },
        unitPrice: { type: Number, required: true },
        // CLINIC: charge patient; OUTSIDE_PURCHASE: patient purchased themselves, no clinic charge.
        source: { type: String, enum: Object.values(MedicationSource), default: MedicationSource.CLINIC },
        // lineTotal = 0 if source is OUTSIDE_PURCHASE or dispensedQty is 0, otherwise dispensedQty * unitPrice.
        lineTotal: { type: Number, required: true },
        _id: false,
      }
    ],
    default: [],
  })
  medications!: Array<{
    medicineId?: Types.ObjectId;
    medicineName: string;
    prescribedQty: number;
    dispensedQty: number;
    unitPrice: number;
    source: MedicationSource;
    lineTotal: number;
  }>;

  @Prop({ enum: BillingStatus, default: BillingStatus.DRAFT })
  status!: BillingStatus;
}

export type BillingDocument = HydratedDocument<Billing>;
export const BillingSchema = SchemaFactory.createForClass(Billing);
