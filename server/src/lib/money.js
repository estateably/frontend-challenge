/**
 * Money is *always* an integer number of minor units (cents for CAD/USD/EUR).
 * Nothing in this API accepts or returns a decimal amount — floats are rejected
 * at the edge so rounding errors can never enter the store.
 *
 *   -4599  =>  an outflow of $45.99
 *    320000 => an inflow of $3,200.00
 *
 * Sign convention, everywhere:
 *   amount  < 0  money left the account (expense, bill, transfer out)
 *   amount  > 0  money entered the account (income, refund, transfer in)
 *   balance < 0  the account is overdrawn, or (for a credit card) you owe money
 */
export const CURRENCIES = {
  CAD: { code: 'CAD', minorUnits: 2, symbol: '$' },
  USD: { code: 'USD', minorUnits: 2, symbol: '$' },
  EUR: { code: 'EUR', minorUnits: 2, symbol: '€' },
};

export const BASE_CURRENCY = 'CAD';

/** Formats minor units for log output. Never used in responses. */
export function formatMinor(amount, currency = BASE_CURRENCY) {
  const { minorUnits, symbol } = CURRENCIES[currency] ?? CURRENCIES[BASE_CURRENCY];
  const factor = 10 ** minorUnits;
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}${symbol}${Math.floor(abs / factor)}.${String(abs % factor).padStart(minorUnits, '0')}`;
}
