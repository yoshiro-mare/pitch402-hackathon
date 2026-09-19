/**
 * Pitch402 configuration.
 *
 * Everything a curator can change per cycle lives here. Tiers and term
 * multipliers are editable without redeploying any contract: the contract
 * stores what was actually paid, this file only decides what to quote next.
 */

export type Term = 'cycle' | '3m' | '1y'

export type Tier = {
  /** first spot number in this tier, inclusive */
  from: number
  /** last spot number in this tier, inclusive */
  to: number
  /** base price in whole USDC, as a decimal string */
  price: string
}

/** Spots in one cycle. Spot numbers are 1..SPOTS_PER_CYCLE. */
export const SPOTS_PER_CYCLE = 100

/** USDC has 6 decimals, not 18. */
export const USDC_DECIMALS = 6

/** Default tier ladder. Editable per cycle. */
export const TIERS: Tier[] = [
  { from: 1, to: 1, price: '10' },
  { from: 2, to: 3, price: '5' },
  { from: 4, to: 10, price: '3' },
  { from: 11, to: 100, price: '1' },
]

/** Term multipliers. Editable per cycle. */
export const TERM_MULTIPLIERS: Record<Term, number> = {
  cycle: 1,
  '3m': 3,
  '1y': 10,
}

export const DEFAULT_TERM: Term = 'cycle'

/** Payment rail. Base Sepolia first — never mainnet while building. */
export const PAYMENT = {
  network: 'base-sepolia',
  chain: 'eip155:84532',
  asset: 'USDC',
  decimals: USDC_DECIMALS,
  facilitator: 'https://x402.org/facilitator',
  /**
   * Base Sepolia USDC. NOT YET VERIFIED — ethskills addresses/SKILL.md covers
   * mainnet only. Verify on the Base Sepolia explorer / Circle docs before any
   * transfer is wired up. Nothing reads this for a transaction yet.
   */
  assetAddress: '0x036CbD53842c5426634e7926541eC2318f3dCF7e',
  assetAddressVerified: false,
} as const

export function isValidTerm(value: string): value is Term {
  return value === 'cycle' || value === '3m' || value === '1y'
}

export function tierFor(spot: number): Tier {
  const tier = TIERS.find((t) => spot >= t.from && spot <= t.to)
  if (!tier) throw new Error(`no tier configured for spot ${spot}`)
  return tier
}
