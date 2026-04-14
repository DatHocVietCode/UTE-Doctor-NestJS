const DEFAULT_COIN_REWARD_RATE = 0.1;
const DEFAULT_COIN_EXPIRY_DAYS = 30;

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

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

export const COIN_REWARD_RATE = parsePositiveNumber(
  process.env.COIN_REWARD_RATE,
  DEFAULT_COIN_REWARD_RATE,
);

export const COIN_EXPIRY_DAYS = parsePositiveInt(
  process.env.COIN_EXPIRY_DAYS,
  DEFAULT_COIN_EXPIRY_DAYS,
);
