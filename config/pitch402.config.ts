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

/** Testnets only. Never mainnet while building. */
export type NetworkId = 'base-sepolia' | 'hsk-testnet'

export type NetworkConfig = {
  id: NetworkId
  name: string
  /** CAIP-2 identifier, e.g. eip155:84532 */
  chain: `eip155:${number}`
  chainId: number
  rpc: string
  explorer: string
  nativeCurrency: string
  /** x402 facilitator that can verify and settle here, or null if none exists */
  facilitator: string | null
  /**
   * 'live'        — a facilitator settles payments on this chain today.
   * 'unavailable' — the network is advertised, but no facilitator will settle
   *                 it yet, so only demo (fake) payments can complete.
   */
  settlement: 'live' | 'unavailable'
  asset: {
    symbol: string
    /** null when no verified stablecoin address is known for this chain */
    address: string | null
    decimals: number
    /** honest flag: true only when checked against the chain itself */
    verified: boolean
    /** EIP-712 domain, read from the contract; null when the asset is unknown */
    eip712: { name: string; version: string } | null
    note?: string
  }
}

export const DEFAULT_NETWORK: NetworkId = 'base-sepolia'

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  'base-sepolia': {
    id: 'base-sepolia',
    name: 'Base Sepolia',
    chain: 'eip155:84532',
    chainId: 84532,
    rpc: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    nativeCurrency: 'ETH',
    facilitator: 'https://x402.org/facilitator',
    settlement: 'live',
    asset: {
      symbol: 'USDC',
      /**
       * Verified 2026-09-19 against chain 84532 by eth_call: symbol() "USDC",
       * name() "USDC", decimals() 6, EIP-712 version() "2", contract has code.
       * Matches the address shipped in @x402/evm.
       */
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      decimals: USDC_DECIMALS,
      verified: true,
      eip712: { name: 'USDC', version: '2' },
    },
  },
  'hsk-testnet': {
    id: 'hsk-testnet',
    name: 'HashKey Chain Testnet',
    chain: 'eip155:133',
    chainId: 133,
    rpc: 'https://testnet.hsk.xyz',
    explorer: 'https://testnet-explorer.hsk.xyz',
    nativeCurrency: 'HSK',
    /**
     * No facilitator is confirmed for this chain. x402.org/facilitator lists
     * eip155:84532 and Solana only — checked 2026-09-20 — so we advertise the
     * network but never claim it will settle there.
     */
    facilitator: null,
    settlement: 'unavailable',
    asset: {
      symbol: 'USDC',
      /**
       * No testnet stablecoin address verified. Chain id 133 and the RPC were
       * confirmed live (eth_chainId returned 0x85), but the explorer API was
       * unreachable and no testnet USDC address could be checked onchain.
       * Deliberately left null rather than guessed: a wrong token address
       * loses funds. Mainnet USDC.e is NOT used here — testnets only.
       */
      address: null,
      decimals: USDC_DECIMALS,
      verified: false,
      eip712: null,
      note: 'Asset TBD. No verified testnet stablecoin address on chain 133 yet — use demo (fake) pay on this network.',
    },
  },
}

/** Base Sepolia stays the default rail. */
export const PAYMENT = NETWORKS[DEFAULT_NETWORK]

/**
 * Where buyers pay. Set PITCH402_PAY_TO in .env.local — never hardcode an
 * address here and never commit a key. The same EVM address works on both
 * testnets for the demo. null means payments are unconfigured.
 */
export const PAY_TO = process.env.PITCH402_PAY_TO ?? null

export function isNetworkId(value: string): value is NetworkId {
  return value === 'base-sepolia' || value === 'hsk-testnet'
}

export function networkFor(id: NetworkId): NetworkConfig {
  return NETWORKS[id]
}

/** Networks a client may choose, in advertised order (default first). */
export function networkList(): NetworkConfig[] {
  return [NETWORKS[DEFAULT_NETWORK], ...Object.values(NETWORKS).filter((n) => n.id !== DEFAULT_NETWORK)]
}

/** Header that stands in for a real x402 payment while we demo without a wallet. */
export const FAKE_PAY_HEADER = 'x-pitch402-fake-pay'

/**
 * Fake payments are a demo shortcut: anyone sending the header gets a free
 * spot. Allowed outside production only, unless explicitly opted in.
 */
export function fakePayAllowed(): boolean {
  if (process.env.PITCH402_ALLOW_FAKE_PAY === '1') return true
  return process.env.NODE_ENV !== 'production'
}

export function isValidTerm(value: string): value is Term {
  return value === 'cycle' || value === '3m' || value === '1y'
}

export function tierFor(spot: number): Tier {
  const tier = TIERS.find((t) => spot >= t.from && spot <= t.to)
  if (!tier) throw new Error(`no tier configured for spot ${spot}`)
  return tier
}
