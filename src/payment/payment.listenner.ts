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

        console.log(`[PaymentListener] Processing payment with method: ${method}`);
        if (method == PaymentMethodEnum.VNPAY || method == PaymentMethodEnum.ONLINE) {
            const ip = payload.ip || '127.0.0.1'; // fallback nếu chưa có IP
            return this.vnPaySerivce.createPayment(appointmentId, amount, ip);
        }   
         // Handle other payment methods here
         return null;
    }
}