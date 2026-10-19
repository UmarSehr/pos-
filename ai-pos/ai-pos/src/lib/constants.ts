/** Products with 0 < quantity < LOW_STOCK_THRESHOLD are flagged as "low stock". */
export const LOW_STOCK_THRESHOLD = 10;

export const PAYMENT_METHODS = ['cash', 'card', 'online'] as const;
