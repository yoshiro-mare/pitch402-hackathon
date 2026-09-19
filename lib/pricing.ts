import {
  DEFAULT_TERM,
  TERM_MULTIPLIERS,
  USDC_DECIMALS,
  type Term,
  tierFor,
} from '@/config/pitch402.config'

export type Price = {
  currency: 'USDC'
  decimals: number
  /** tier base price in whole USDC, decimal string */
  base: string
  term: Term
  multiplier: number
  /** base * multiplier, decimal string, e.g. "30" */
  amount: string
  /** same value in USDC's smallest unit (6 decimals), decimal string */
  amountAtomic: string
}

/** Parse a decimal string like "2.5" into USDC's smallest unit. */
export function toAtomic(decimalAmount: string, decimals = USDC_DECIMALS): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(decimalAmount.trim())
  if (!match) throw new Error(`not a decimal amount: ${decimalAmount}`)
  const [, whole, fraction = ''] = match
  if (fraction.length > decimals) {
    throw new Error(`${decimalAmount} has more than ${decimals} decimals`)
  }
  return BigInt(whole + fraction.padEnd(decimals, '0'))
}

/** Render USDC's smallest unit back to a trimmed decimal string. */
export function fromAtomic(atomic: bigint, decimals = USDC_DECIMALS): string {
  const base = 10n ** BigInt(decimals)
  const whole = atomic / base
  const fraction = (atomic % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

/**
 * Price a spot. This is the quote price only — the price a buyer actually pays
 * is snapshotted at payment time and never repriced afterwards.
 */
export function priceFor(spot: number, term: Term = DEFAULT_TERM): Price {
  const tier = tierFor(spot)
  const multiplier = TERM_MULTIPLIERS[term]
  const amountAtomic = toAtomic(tier.price) * BigInt(multiplier)
  return {
    currency: 'USDC',
    decimals: USDC_DECIMALS,
    base: tier.price,
    term,
    multiplier,
    amount: fromAtomic(amountAtomic),
    amountAtomic: amountAtomic.toString(),
  }
}
