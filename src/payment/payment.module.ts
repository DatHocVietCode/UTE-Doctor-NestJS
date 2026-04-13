import { forwardRef, Module } from '@nestjs/common';
import { AppointmentModule } from 'src/appointment/appointment.module';
import { PaymentService } from "./payment.service";
import { VnPayPaymentController } from "./vnpay/vnpay-payment.controller";
import { VnPayPaymentService } from "./vnpay/vnpay-payment.service";

@Module({
    imports: [forwardRef(() => AppointmentModule)],
    controllers: [VnPayPaymentController],
    providers: [PaymentService, VnPayPaymentService],
    exports: [PaymentService]
})
export class PaymentModule {}