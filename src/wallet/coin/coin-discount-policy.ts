export const DEFAULT_COIN_DISCOUNT_RATE = 0.1;
export const DEFAULT_COIN_DISCOUNT_CAP = 30000;

export function calculateCoinDiscountLimit(
  originalAmount: number,
  discountRate = DEFAULT_COIN_DISCOUNT_RATE,
  discountCap = DEFAULT_COIN_DISCOUNT_CAP,
): number {
  const safeAmount = Math.max(0, Math.floor(originalAmount || 0));
  if (safeAmount <= 0) {
    return 0;
  }

  const rateLimit = Math.floor(safeAmount * discountRate);
  return Math.max(0, Math.min(safeAmount, discountCap, rateLimit));
}
