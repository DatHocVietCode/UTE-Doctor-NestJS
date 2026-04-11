import { BadRequestException, Injectable } from '@nestjs/common';
import moment from 'moment';
import { GlobalConfig, HashAlgorithm, VNPay } from 'vnpay';
import { VNPAY_EXPIRE_MINUTES } from './vnpay-timeout.config';

export type PaymentResultStatus = 'COMPLETED' | 'FAILED';

export interface VnpayReturnResult {
  valid: boolean;
  status: PaymentResultStatus;
  orderId: string;
  amount: number;
  responseCode: string;
  transactionStatus: string;
  paidAt: Date | null;
  reason?: string;
}

@Injectable()
export class VnPayPaymentService {
  private vnpay = new VNPay({
    tmnCode: process.env.VN_PAY_TMNCODE!,
    secureSecret: process.env.VN_PAY_HASHSECRET!,
    vnpayHost: 'https://sandbox.vnpayment.vn',
    testMode: true,
    hashAlgorithm: HashAlgorithm.SHA512,
  });

  createPayment(orderId: string, amount: number, ip: string): string {
    try {
      // Xử lý IP address: extract IPv4 từ IPv6 hoặc x-forwarded-for
      const ipAddr = this.extractIPv4(ip);

      const paymentParams = {
        vnp_Amount: amount * 100,
        vnp_IpAddr: ipAddr,
        vnp_TxnRef: orderId,
        vnp_OrderInfo: `Thanh toan don hang ${orderId}`,
        vnp_ReturnUrl: process.env.VN_PAY_RETURNURL!,
        vnp_CreateDate: Number(moment().format("YYYYMMDDHHmmss")),
        vnp_ExpireDate: Number(moment().add(VNPAY_EXPIRE_MINUTES, "minutes").format("YYYYMMDDHHmmss")),
        vnp_CurrCode: "VND" as GlobalConfig['vnp_CurrCode'],
        vnp_Locale: "vn" as GlobalConfig['vnp_Locale'],
        vnp_OrderType: "other" as GlobalConfig['vnp_OrderType'],
        vnp_BankCode: "NCB"
      };

      console.log("VNPay Parameters:", paymentParams);
      
      const url = this.vnpay.buildPaymentUrl(paymentParams);

      if (!url) {
        throw new Error('buildPaymentUrl returned empty URL');
      }

      console.log("Generated VnPay URL:", url);
      return url;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("❌ VNPay Payment Error:", error);
      throw new BadRequestException(`Failed to create payment URL: ${errorMsg}`);
    }
  }

  private extractIPv4(ip: string): string {
    if (!ip) return "127.0.0.1";
    
    // Handle IPv6-mapped IPv4 (::ffff:192.0.2.1)
    if (ip.includes("::ffff:")) {
      return ip.replace("::ffff:", "");
    }
    
    // Handle IPv6 localhost
    if (ip === "::1") {
      return "127.0.0.1";
    }
    
    // Handle multiple IPs from x-forwarded-for (take first one)
    if (ip.includes(",")) {
      return ip.split(",")[0].trim();
    }
    
    return ip;
  }

  handleVnpayReturn(query: Record<string, any>): VnpayReturnResult {
    try {
      console.log('[VNPay] return query:', query);
      const isValid = this.vnpay.verifyReturnUrl(query as any);
      const orderId = String(query['vnp_TxnRef'] || '');
      const amount = Number(query['vnp_Amount'] || 0) / 100;
      const responseCode = String(query['vnp_ResponseCode'] || '');
      const transactionStatus = String(query['vnp_TransactionStatus'] || '');
      const paidAt = this.parseVnpPayDateToUtc(query['vnp_PayDate']);
      
      if (!isValid) {
        console.warn('[VNPay] invalid checksum');
        return {
          valid: false,
          status: 'FAILED',
          orderId,
          amount,
          responseCode: responseCode || '97',
          transactionStatus,
          paidAt,
          reason: 'Invalid checksum',
        };
      }

      const isSuccess = responseCode === '00' && transactionStatus === '00';

      if (isSuccess) {
        console.log('[VNPay] payment success for order:', orderId);
        return {
          valid: true,
          status: 'COMPLETED',
          orderId,
          amount,
          responseCode,
          transactionStatus,
          paidAt,
        };
      }

      console.warn(
        `[VNPay] payment failed for order ${orderId}: responseCode=${responseCode}, transactionStatus=${transactionStatus}`,
      );
      return {
        valid: true,
        status: 'FAILED',
        orderId,
        amount,
        responseCode,
        transactionStatus,
        paidAt,
        reason: `VNPay responseCode=${responseCode}, transactionStatus=${transactionStatus}`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[VNPay] return processing error:', error);
      return {
        valid: false,
        status: 'FAILED',
        orderId: String(query?.['vnp_TxnRef'] || ''),
        amount: 0,
        responseCode: '99',
        transactionStatus: '',
        paidAt: null,
        reason: errorMsg,
      };
    }
  }

  private parseVnpPayDateToUtc(rawPayDate: unknown): Date | null {
    if (!rawPayDate) {
      return null;
    }

    const payDateStr = String(rawPayDate);
    if (!/^\d{14}$/.test(payDateStr)) {
      return null;
    }

    // VNPay sends yyyyMMddHHmmss in GMT+7. Convert to UTC before storage.
    const parsed = moment(payDateStr, 'YYYYMMDDHHmmss').utcOffset(7, true).utc();
    return parsed.isValid() ? parsed.toDate() : null;
  }
}
