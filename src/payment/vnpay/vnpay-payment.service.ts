import { Injectable } from '@nestjs/common';
import { HashAlgorithm, VNPay } from 'vnpay';

@Injectable()
export class VnPayPaymentService {
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

  handleVnpayReturn(query: any) {
    const isValid = this.vnpay.verifyReturnUrl(query);
    if (!isValid) {
      return {
        valid: false,
        success: false,
        orderId: query['vnp_TxnRef'],
        amount: Number(query['vnp_Amount'] || 0) / 100,
        code: '97',
        message: 'Invalid checksum',
        reason: 'Invalid checksum',
      };
    }

    const vnpResponseCode = query['vnp_ResponseCode'];
    if (vnpResponseCode === '00') {
      return {
        valid: true,
        success: true,
        orderId: query['vnp_TxnRef'],
        amount: Number(query['vnp_Amount'] || 0) / 100,
        code: '00',
        message: 'Payment successful',
      };
    }

    return {
      valid: true,
      success: false,
      orderId: query['vnp_TxnRef'],
      amount: Number(query['vnp_Amount'] || 0) / 100,
      code: vnpResponseCode,
      message: 'Payment failed',
      reason: `VnPay response code: ${vnpResponseCode}`,
    };
  }
}
