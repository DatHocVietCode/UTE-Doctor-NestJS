import { Injectable } from '@nestjs/common';
import { HashAlgorithm, VNPay } from 'vnpay';
import crypto from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class VnPayPaymentService {
  constructor(private readonly eventEmitter: EventEmitter2) {}
  private vnpay = new VNPay({
    tmnCode: process.env.VN_PAY_TMNCODE!,
    secureSecret: process.env.VN_PAY_HASHSECRET!,
    vnpayHost: 'https://sandbox.vnpayment.vn',
    testMode: true,
    hashAlgorithm: HashAlgorithm.SHA512,
  });

  createPayment(orderId: string, amount: number, ip: string) : string {
    const url = this.vnpay.buildPaymentUrl({
      vnp_Amount: amount * 100,
      vnp_IpAddr: ip,
      vnp_TxnRef: orderId,
      vnp_OrderInfo: `Thanh toán đơn hàng ${orderId}`,
      vnp_ReturnUrl: process.env.VN_PAY_RETURNURL!, // URL để VnPay redirect về sau khi thanh toán
    });
    return url;
  }

 async handleVnpayReturn(query: any) {
    console.log('VnPay return query:', query);
    const isValid = this.vnpay.verifyReturnUrl(query);
    if (!isValid) {
      this.eventEmitter.emit('payment.failed', { orderId: query['vnp_TxnRef'], reason: 'Invalid checksum' });
      return { code: '97', message: 'Invalid checksum' };
    }

    const vnpResponseCode = query['vnp_ResponseCode'];
    if (vnpResponseCode === '00') {
      this.eventEmitter.emit('payment.success', { orderId: query['vnp_TxnRef'], amount: query['vnp_Amount'] / 100 });
      // Payment successful
      return { code: '00', message: 'Payment successful', orderId: query['vnp_TxnRef'] };
    } else {
      this.eventEmitter.emit('payment.failed', { orderId: query['vnp_TxnRef'], reason: `VnPay response code: ${vnpResponseCode}` });
      // Payment failed
      return { code: vnpResponseCode, message: 'Payment failed', orderId: query['vnp_TxnRef'] };
    }
  }
}
