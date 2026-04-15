// Reward ratio from consultation fee to coin (e.g. 0.1 => 10%).
export const COIN_REWARD_RATE = Math.max(0, Number(process.env.COIN_REWARD_RATE ?? 0.1));

// Reward coin expiry window in days.
export const COIN_EXPIRY_DAYS = Math.max(0, Number(process.env.COIN_EXPIRY_DAYS ?? 3));

// Generic earn flow default expiry when caller does not provide explicit expiresAt.
export const COIN_DEFAULT_EXPIRE_DAYS = Math.max(1, Number(process.env.COIN_DEFAULT_EXPIRE_DAYS ?? 180));
