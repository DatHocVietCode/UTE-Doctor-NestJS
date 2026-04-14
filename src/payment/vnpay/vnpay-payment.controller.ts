import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import express from 'express';
import { AppointmentBookingService } from 'src/appointment/appointment-booking.service';
import { PaymentService } from '../payment.service';

@Controller()
export class VnPayPaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly appointmentBookingService: AppointmentBookingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Get('payment/create_payment_url')
  createPayment(@Query('orderId') orderId: string, @Query('amount') amount: number, @Req() req: express.Request) {
    const ipAddr = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log('Client IP Address:', ipAddr);
    const url = this.paymentService.createPaymentUrl(orderId, amount, ipAddr as string);
    return { paymentUrl: url };
  }

  @Get('payment/vnpay_return')
  async vnpayReturn(@Query() query: Record<string, any>, @Res() res: express.Response) {
    const result = this.paymentService.handleVnpayReturn(query);
    console.log('[VNPay] verification result:', result);

    if (result.orderId) {
      const updateResult = await this.appointmentBookingService.handleVnpayCallbackResult({
        orderId: result.orderId,
        success: result.status === 'COMPLETED',
        reason: result.reason,
        // Business amount is persisted when booking is created; callback amount is informational only.
        amount: undefined,
        paidAt: result.paidAt,
        responseCode: result.responseCode,
        transactionStatus: result.transactionStatus,
      });

      console.log('[VNPay] appointment update result:', updateResult);

      this.eventEmitter.emit('payment.update', {
        orderId: result.orderId,
        status: result.status,
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectParams = new URLSearchParams({
      orderId: result.orderId || '',
      status: result.status,
      code: result.responseCode || '',
    });

    return res.redirect(`${frontendUrl}/payment-result?${redirectParams.toString()}`);
  }

  @Get('payment/:orderId')
  async getPaymentStatus(@Param('orderId') orderId: string) {
    return this.appointmentBookingService.getPaymentStatus(orderId);
  }

  @Get('payments/:orderId')
  async getPaymentStatusV2(@Param('orderId') orderId: string) {
    return this.appointmentBookingService.getPaymentStatus(orderId);
  }
}
