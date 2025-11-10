import { Module } from "@nestjs/common";
import { PaymentService } from "./payment.service";
import { VnPayPaymentController } from "./vnpay/vnpay-payment.controller";
import { VnPayPaymentService } from "./vnpay/vnpay-payment.service";
import { PaymentListener } from "./payment.listenner";

@Module({
    imports: [],
    controllers: [VnPayPaymentController],
    providers: [PaymentService, VnPayPaymentService, PaymentListener],
    exports: [PaymentService]
})
export class PaymentModule {}