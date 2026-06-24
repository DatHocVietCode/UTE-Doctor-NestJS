import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import moment from 'moment';
import { GlobalConfig, HashAlgorithm, VNPay } from 'vnpay';
import { VNPAY_EXPIRE_MINUTES, VNPAY_TIMEZONE, VNPAY_UTC_OFFSET_HOURS } from './vnpay-timeout.config';

export type PaymentResultStatus = 'COMPLETED' | 'FAILED';

export interface VnpayReturnResult {
  valid: boolean;
  status: PaymentResultStatus;
  orderId: string;
  txnRef: string;
  billingId: string;
  amount: number;
  responseCode: string;
  transactionStatus: string;
  paidAt: Date | null;
  reason?: string;
}

@Injectable()
export class VnPayPaymentService {
  private readonly logger = new Logger(VnPayPaymentService.name);

  private vnpay = new VNPay({
    tmnCode: process.env.VN_PAY_TMNCODE!,
    secureSecret: process.env.VN_PAY_HASHSECRET!,
    vnpayHost: 'https://sandbox.vnpayment.vn',
    testMode: true,
    hashAlgorithm: HashAlgorithm.SHA512,
  });

  createPaymentUrl(txnRef: string, amount: number, ip: string, orderInfo?: string): string {
    try {
      // VNPay expects a stable reference; billingId is now the canonical txnRef for payment callbacks.
      const ipAddr = this.extractIPv4(ip);
      const amountVnd = Math.max(0, Math.floor(amount || 0));
      const returnUrl = process.env.VN_PAY_RETURNURL!;

      // VNPay's gateway runs on Vietnam time (UTC+7). Format the timestamps with an explicit
      // offset so they are correct regardless of the server/container timezone (EC2 Docker = UTC).
      const nowVn = moment().utcOffset(VNPAY_UTC_OFFSET_HOURS);
      const createDate = nowVn.format('YYYYMMDDHHmmss');
      const expireDate = nowVn
        .clone()
        .add(VNPAY_EXPIRE_MINUTES, 'minutes')
        .format('YYYYMMDDHHmmss');

      const paymentParams = {
        vnp_Amount: amountVnd,
        vnp_IpAddr: ipAddr,
        vnp_TxnRef: txnRef,
        vnp_OrderInfo: orderInfo ?? `Thanh toan hoa don ${txnRef}`,
        vnp_ReturnUrl: returnUrl,
        vnp_CreateDate: Number(createDate),
        vnp_ExpireDate: Number(expireDate),
        vnp_CurrCode: "VND" as GlobalConfig['vnp_CurrCode'],
        vnp_Locale: "vn" as GlobalConfig['vnp_Locale'],
        vnp_OrderType: "other" as GlobalConfig['vnp_OrderType'],
        vnp_BankCode: "NCB"
      };

      // Diagnostic log: never logs the hash secret; the secure hash is computed inside
      // buildPaymentUrl AFTER every param above is finalized.
      this.logger.log(
        `Building VNPay URL | txnRef=${txnRef} | amountVnd=${amountVnd} | returnUrl=${returnUrl} | ` +
          `createDate=${createDate} | expireDate=${expireDate} | expireMinutes=${VNPAY_EXPIRE_MINUTES} | ` +
          `tz=${VNPAY_TIMEZONE} (UTC+${VNPAY_UTC_OFFSET_HOURS}) | serverUtcOffsetMin=${moment().utcOffset()}`,
      );

      const url = this.vnpay.buildPaymentUrl(paymentParams);

      if (!url) {
        throw new Error('buildPaymentUrl returned empty URL');
      }

      this.logger.debug(`Generated VNPay URL | txnRef=${txnRef} | url=${url}`);
      return url;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`VNPay payment URL error | txnRef=${txnRef} | ${errorMsg}`);
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
      const txnRef = String(query['vnp_TxnRef'] || '');
      const billingId = txnRef;
      // Convert back from VNPay smallest unit to VND at boundary layer.
      const amount = Math.max(0, Math.floor(Number(query['vnp_Amount'] || 0) / 100));
      const responseCode = String(query['vnp_ResponseCode'] || '');
      const transactionStatus = String(query['vnp_TransactionStatus'] || '');
      const paidAt = this.parseVnpPayDateToUtc(query['vnp_PayDate']);
      
      if (!isValid) {
        console.warn('[VNPay] invalid checksum');
        return {
          valid: false,
          status: 'FAILED',
          orderId: billingId,
          txnRef,
          billingId,
          amount,
          responseCode: responseCode || '97',
          transactionStatus,
          paidAt,
          reason: 'Invalid checksum',
        };
      }

      const isSuccess = responseCode === '00' && transactionStatus === '00';

      if (isSuccess) {
        console.log('[VNPay] payment success for billing:', billingId);
        return {
          valid: true,
          status: 'COMPLETED',
          orderId: billingId,
          txnRef,
          billingId,
          amount,
          responseCode,
          transactionStatus,
          paidAt,
        };
      }

      console.warn(
        `[VNPay] payment failed for billing ${billingId}: responseCode=${responseCode}, transactionStatus=${transactionStatus}`,
      );
      return {
        valid: true,
        status: 'FAILED',
        orderId: billingId,
        txnRef,
        billingId,
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
        txnRef: String(query?.['vnp_TxnRef'] || ''),
        billingId: String(query?.['vnp_TxnRef'] || ''),
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
