export type CoinSummaryBreakdownItemDto = {
  transactionId: string;
  amount: number;
  used: number;
  remaining: number;
  createdAt: number | null;
  expiresAt: number | null;
  category: 'active' | 'expired' | 'non_expiring';
  isExpiringSoon: boolean;
};

export type CoinSummaryResponseDto = {
  totalBalance: number;
  usableCoin: number;
  expiredCoin: number;
  expiringSoon: number;
  breakdown: CoinSummaryBreakdownItemDto[];
};
