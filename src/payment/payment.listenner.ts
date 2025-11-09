import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { VnPayPaymentService } from "./vnpay/vnpay-payment.service";
import { PaymentMethodEnum } from "./enums/payment-method.enum";


@Injectable()
export class PaymentListener {
    constructor(private readonly vnPaySerivce: VnPayPaymentService) {}


    @OnEvent('appointment.handle.payment')
    async processPayment(payload: any) {
       const { method, amount, appointmentId } = payload;
        if (method == PaymentMethodEnum.VNPAY || method == PaymentMethodEnum.ONLINE) {
            return this.vnPaySerivce.createPayment(amount, payload, appointmentId);
        }   
         // Handle other payment methods here
         return null;
    }
}