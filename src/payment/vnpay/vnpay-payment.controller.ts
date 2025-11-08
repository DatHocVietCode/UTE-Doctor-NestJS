import { Controller, Get, Query, Req } from '@nestjs/common';
import express from 'express';
import { VnPayPaymentService } from './vnpay-payment.service';

@Controller('payment')
export class VnPayPaymentController {
  constructor(private readonly vnPaymentService: VnPayPaymentService) {}

  @Get('create_payment_url')
  createPayment(@Query('orderId') orderId: string, @Query('amount') amount: number, @Req() req: express.Request) {
    const ipAddr = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const url = this.vnPaymentService.createPayment(orderId, amount, ipAddr as string);
    return { paymentUrl: url };
  }

  @Get('vnpay_return')
  vnpayReturn(@Query() query: any) {
    return this.vnPaymentService.handleVnpayReturn(query);
  }
}
