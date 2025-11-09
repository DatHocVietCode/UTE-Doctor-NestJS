import { Prop, Schema } from "@nestjs/mongoose";
import mongoose from "mongoose";
import { PaymentMethodEnum } from "../enums/payment-method.enum";
import { PaymentStatusEnum } from "../enums/payment-status.enum";


@Schema({timestamps: true})
export class Payment {
    _id: mongoose.Types.ObjectId;

    @Prop()
    amount: number;

    @Prop({type: PaymentMethodEnum, required: true, default: PaymentMethodEnum.CASH})
    method: PaymentMethodEnum;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true })
    appointmentId: mongoose.Types.ObjectId;  // Extendable for other services, like switching to orderId


    @Prop({type: PaymentStatusEnum, default: PaymentStatusEnum.PENDING})
    status: PaymentStatusEnum;

    @Prop()
    transactionId: string;

    @Prop()
    refundTransactionNo?: string;

    @Prop()
    refundedAt?: Date;

    @Prop()
    paidAt?: Date;
}