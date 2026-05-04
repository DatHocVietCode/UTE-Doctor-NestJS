import { Controller, Get, Param, Query, Req, Res, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import express from 'express';
import { AppointmentBookingService } from 'src/appointment/appointment-booking.service';
import { PaymentService } from '../payment.service';

@Controller()
export class VnPayPaymentController {
  private readonly logger = new Logger(VnPayPaymentController.name);
  constructor(
    private readonly paymentService: PaymentService,
    private readonly appointmentBookingService: AppointmentBookingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Get('payment/create_payment_url')
  createPayment(@Query('orderId') orderId: string, @Query('amount') amount: number, @Req() req: express.Request) {
    this.logger.warn('Deprecated payment endpoint called', { endpoint: 'payment/create_payment_url', orderId });
    throw new BadRequestException('Payment after booking is deprecated. Use billing flow.');
  }

  @Get('payment/vnpay_return')
  async vnpayReturn(@Query() query: Record<string, any>, @Res() res: express.Response) {
    this.logger.warn('Deprecated payment callback called', { endpoint: 'payment/vnpay_return', query });
    throw new BadRequestException('Payment after booking is deprecated. Use billing flow.');
  }

  @Get('payment/:orderId')
  async getPaymentStatus(@Param('orderId') orderId: string) {
    this.logger.warn('Deprecated payment status endpoint called', { endpoint: 'payment/:orderId', orderId });
    throw new BadRequestException('Payment after booking is deprecated. Use billing flow.');
  }

  @Get('payments/:orderId')
  async getPaymentStatusV2(@Param('orderId') orderId: string) {
    this.logger.warn('Deprecated payment status endpoint called', { endpoint: 'payments/:orderId', orderId });
    throw new BadRequestException('Payment after booking is deprecated. Use billing flow.');
  }
}
