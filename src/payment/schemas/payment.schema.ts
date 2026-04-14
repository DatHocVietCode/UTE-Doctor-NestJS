import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { PaymentMethodEnum } from "../enums/payment-method.enum";
import { PaymentStatusEnum } from "../enums/payment-status.enum";

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({timestamps: true})
export class Payment {
    _id!: mongoose.Types.ObjectId;

    @Prop()
    amount!: number;

    @Prop({ type: String, enum: PaymentMethodEnum, required: true, default: PaymentMethodEnum.CASH })
    method!: PaymentMethodEnum;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true })
    appointmentId!: mongoose.Types.ObjectId;  // Extendable for other services, like switching to orderId


    @Prop({ type: String, enum: PaymentStatusEnum, default: PaymentStatusEnum.PENDING })
    status!: PaymentStatusEnum;

    @Prop()
    transactionId!: string;

    @Prop()
    refundTransactionNo?: string;

    @Prop()
    refundedAt?: Date;

    @Prop()
    paidAt?: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

// One logical payment record per appointment to keep payment creation idempotent.
PaymentSchema.index({ appointmentId: 1 }, { unique: true });

// Transaction id (if present) should not collide.
PaymentSchema.index({ transactionId: 1 }, { unique: true, sparse: true });