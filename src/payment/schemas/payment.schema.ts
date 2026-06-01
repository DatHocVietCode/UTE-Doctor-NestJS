import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { PaymentFlowMethodEnum, PaymentFlowStatusEnum } from '../enums/payment-flow.enum';

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({ timestamps: true })
export class Payment {
    _id!: mongoose.Types.ObjectId;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Billing', required: true, unique: true })
    billingId!: mongoose.Types.ObjectId;

    @Prop({ required: true, min: 0 })
    amount!: number;

    @Prop({ type: String, enum: PaymentFlowMethodEnum, required: true, default: PaymentFlowMethodEnum.QR })
    method!: PaymentFlowMethodEnum;

    @Prop({ type: String, enum: PaymentFlowStatusEnum, required: true, default: PaymentFlowStatusEnum.PENDING })
    status!: PaymentFlowStatusEnum;

    @Prop({ required: true, unique: true })
    idempotencyKey!: string;

    @Prop({ type: Date, default: null })
    expireAt?: Date | null;

    @Prop()
    transactionId?: string;

    @Prop()
    refundedAt?: Date;

    @Prop()
    paidAt?: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

// One logical payment record per billing to keep payment creation idempotent.
PaymentSchema.index({ billingId: 1 }, { unique: true });

// Transaction id (if present) should not collide.
PaymentSchema.index({ transactionId: 1 }, { unique: true, sparse: true });
// Pending payments can expire automatically when expireAt passes.
PaymentSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });