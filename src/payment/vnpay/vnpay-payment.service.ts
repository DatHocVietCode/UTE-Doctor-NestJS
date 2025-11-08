import { Injectable } from '@nestjs/common';
import { HashAlgorithm, VNPay } from 'vnpay';
import crypto from 'crypto';

@Injectable()
export class VnPayPaymentService {
  private vnpay = new VNPay({
    tmnCode: process.env.VN_PAY_TMNCODE!,
    secureSecret: process.env.VN_PAY_HASHSECRET!,
    vnpayHost: 'https://sandbox.vnpayment.vn',
    testMode: true,
    hashAlgorithm: HashAlgorithm.SHA512,
  });

  createPayment(orderId: string, amount: number, ip: string) {
    const url = this.vnpay.buildPaymentUrl({
      vnp_Amount: amount * 100,
      vnp_IpAddr: ip,
      vnp_TxnRef: orderId,
      vnp_OrderInfo: `Thanh toán đơn hàng ${orderId}`,
      vnp_ReturnUrl: process.env.VN_PAY_RETURNURL!,
    });
    return url;
  }

 async handleVnpayReturn(query: any) {
    const isValid = this.vnpay.verifyReturnUrl(query);
    if (!isValid) {
      return { code: '97', message: 'Invalid checksum' };
    }

    const vnpResponseCode = query['vnp_ResponseCode'];
    if (vnpResponseCode === '00') {
      // Payment successful
      return { code: '00', message: 'Payment successful', orderId: query['vnp_TxnRef'] };
    } else {
      // Payment failed
      return { code: vnpResponseCode, message: 'Payment failed', orderId: query['vnp_TxnRef'] };
    }
  }
}
