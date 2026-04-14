const DEFAULT_VNPAY_EXPIRE_MINUTES = 15;

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
