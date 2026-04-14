export enum PaymentMethodEnum {
    VNPAY = 'VNPAY',
    ONLINE = 'ONLINE',
    CREDIT = 'CREDIT',
    // Deprecated: coin is now discount-only and must not be treated as a full payment method.
    COIN = 'COIN',
    OFFLINE = 'OFFLINE',
    CASH = 'CASH'
}