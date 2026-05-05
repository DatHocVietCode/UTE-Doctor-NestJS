import { Controller, Param, Post } from '@nestjs/common';
import { PaymentService } from './payment.service';

@Controller('payments')
export class PaymentController {
	constructor(private readonly paymentService: PaymentService) {}

	@Post(':paymentId/success')
	async paymentSuccess(@Param('paymentId') paymentId: string) {
		return this.paymentService.markPaymentSuccess(paymentId, 'system', 'QR');
	}
}