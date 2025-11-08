import { Module } from "@nestjs/common";
import { PaymentService } from "./payment.service";
import { VnPayPaymentController } from "./vnpay/vnpay-payment.controller";
import { VnPayPaymentService } from "./vnpay/vnpay-payment.service";

@Module({
    imports: [],
    controllers: [VnPayPaymentController],
    providers: [PaymentService, VnPayPaymentService],
    exports: [PaymentService]
})
export class PaymentModule {}