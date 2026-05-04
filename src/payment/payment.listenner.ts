import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { VnPayPaymentService } from "./vnpay/vnpay-payment.service";
import { PaymentMethodEnum } from "./enums/payment-method.enum";



@Injectable()
export class PaymentListener {
    constructor(private readonly vnPaySerivce: VnPayPaymentService) {}


    @OnEvent('appointment.handle.payment')
    async processPayment(payload: any) : Promise<string | null> {
       const { method, amount, appointmentId } = payload;

        // DEPRECATION: Inline payment triggered by appointment events is disabled.
        // TODO: REMOVE AFTER FULL MIGRATION
        console.warn(`[Deprecated] appointment.handle.payment event ignored for appointment ${appointmentId}`, { method, amount });
        return null;
    }
}