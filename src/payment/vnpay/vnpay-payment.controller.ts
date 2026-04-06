import { Controller, Get, Query, Req } from '@nestjs/common';
import express from 'express';
import { AppointmentBookingService } from 'src/appointment/appointment-booking.service';
import { PaymentService } from '../payment.service';

@Controller('payment')
export class VnPayPaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly appointmentBookingService: AppointmentBookingService,
  ) {}

  @Get('create_payment_url')
  createPayment(@Query('orderId') orderId: string, @Query('amount') amount: number, @Req() req: express.Request) {
    const ipAddr = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log('Client IP Address:', ipAddr);
    const url = this.paymentService.createPaymentUrl(orderId, amount, ipAddr as string);
    return { paymentUrl: url };
  }

  @Get('vnpay_return')
  async vnpayReturn(@Query() query: any) {
    const result = this.paymentService.handleVnpayReturn(query);

    if (!result.orderId) {
      return result;
    }

    if (result.success) {
      return this.appointmentBookingService.handleVnpayReturn(result.orderId, true, result.message);
    }

    return this.appointmentBookingService.handleVnpayReturn(result.orderId, false, result.reason || result.message);
  }
}
