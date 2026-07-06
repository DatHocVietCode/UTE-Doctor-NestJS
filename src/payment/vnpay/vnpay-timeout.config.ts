const DEFAULT_VNPAY_EXPIRE_MINUTES = 1;

/**
 * VNPay's gateway operates on Vietnam time (Asia/Ho_Chi_Minh, fixed UTC+7, no DST).
 * vnp_CreateDate / vnp_ExpireDate MUST be formatted in this timezone regardless of the
 * server/container timezone, otherwise a UTC container produces timestamps 7h in the past
 * and VNPay immediately rejects the transaction as expired.
 */
export const VNPAY_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const VNPAY_UTC_OFFSET_HOURS = 7;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export const VNPAY_EXPIRE_MINUTES = parsePositiveInt(
  process.env.VN_PAY_EXPIRE_MINUTES,
  DEFAULT_VNPAY_EXPIRE_MINUTES,
);

export const BOOKING_PENDING_TTL_SECONDS = VNPAY_EXPIRE_MINUTES * 60;
