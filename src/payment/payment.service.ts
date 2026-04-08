import { Injectable } from '@nestjs/common';
import { VnPayPaymentService } from './vnpay/vnpay-payment.service';
import { VnpayReturnResult } from './vnpay/vnpay-payment.service';


@Injectable()
export class PaymentService {
	constructor(private readonly vnPayPaymentService: VnPayPaymentService) {}

	createPaymentUrl(orderId: string, amount: number, ip: string) {
		return this.vnPayPaymentService.createPayment(orderId, amount, ip);
	}

	handleVnpayReturn(query: Record<string, any>): VnpayReturnResult {
		return this.vnPayPaymentService.handleVnpayReturn(query);
	}

}