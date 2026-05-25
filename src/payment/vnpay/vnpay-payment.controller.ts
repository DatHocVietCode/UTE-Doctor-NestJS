import { BadRequestException, Controller, Get, Logger, Param, Query } from '@nestjs/common';
import { PaymentService } from 'src/payment/payment.service';
import { VnPayPaymentService } from './vnpay-payment.service';

@Controller()
export class VnPayPaymentController {
  private readonly logger = new Logger(VnPayPaymentController.name);
  constructor(
    private readonly paymentService: PaymentService,
    private readonly vnPayPaymentService: VnPayPaymentService,
  ) {}

  @Get('payment/create_payment_url')
  createPayment(@Query('orderId') orderId: string, @Query('amount') amount: number) {
    this.logger.warn(`Deprecated payment endpoint called | endpoint=payment/create_payment_url | orderId=${orderId}`);
    throw new BadRequestException('Payment after booking is deprecated. Use billing flow.');
  }

  @Get('payment/vnpay_return')
  async vnpayReturn(@Query() query: Record<string, any>) {
    const result = this.vnPayPaymentService.handleVnpayReturn(query);

    if (!result.valid) {
      this.logger.warn(`VNPay callback rejected | txnRef=${result.txnRef} | reason=${result.reason ?? 'unknown'}`);
      throw new BadRequestException(result.reason ?? 'Invalid VNPay callback');
    }

    if (result.status === 'COMPLETED') {
      const callbackResult = await this.paymentService.handleVnpayPaymentResultByTxnRef(
        result.txnRef,
        'system',
        {
          transactionId: String(query['vnp_TransactionNo'] || ''),
          paidAt: result.paidAt,
          responseCode: result.responseCode,
          transactionStatus: result.transactionStatus,
        },
      ) as {
        data: {
          billingId?: string;
          appointmentId?: string;
          paymentId: string;
          status: string;
          amount: number;
          method: string;
        };
      };

      this.logger.log(`VNPay callback completed | txnRef=${result.txnRef} | paymentId=${callbackResult.data.paymentId}`);
      return {
        code: 'SUCCESS',
        message: 'Payment successful',
        data: {
          billingId: callbackResult.data.billingId,
          appointmentId: callbackResult.data.appointmentId,
          paymentId: callbackResult.data.paymentId,
          status: callbackResult.data.status,
          amount: callbackResult.data.amount,
          method: callbackResult.data.method,
        },
      };
    }

    this.logger.warn(
      `VNPay callback failed | txnRef=${result.txnRef} | responseCode=${result.responseCode} | transactionStatus=${result.transactionStatus}`,
    );

    await this.paymentService.handleVnpayPaymentFailureByTxnRef(
      result.txnRef,
      {
        transactionId: String(query['vnp_TransactionNo'] || ''),
        paidAt: result.paidAt,
        responseCode: result.responseCode,
        transactionStatus: result.transactionStatus,
      },
    );

    return {
      code: 'FAILED',
      message: result.reason ?? 'Payment failed',
      data: result,
    };
  }

  @Get('payment/:orderId')
  async getPaymentStatus(@Param('orderId') orderId: string) {
    this.logger.warn(`Deprecated payment status endpoint called | endpoint=payment/:orderId | orderId=${orderId}`);
    throw new BadRequestException('Payment after booking is deprecated. Use billing flow.');
  }

  @Get('payments/:orderId')
  async getPaymentStatusV2(@Param('orderId') orderId: string) {
    this.logger.warn(`Deprecated payment status endpoint called | endpoint=payments/:orderId | orderId=${orderId}`);
    throw new BadRequestException('Payment after booking is deprecated. Use billing flow.');
  }
}
