import {
  DEFAULT_NETWORK,
  isNetworkId,
  networkList,
  type NetworkConfig,
  type NetworkId,
} from '@/config/pitch402.config'
import type { Price } from '@/lib/pricing'

/**
 * Resolve the network a client asked for. Query string wins over the body,
 * because paid requests are priced before the body is read. Returns an error
 * code rather than throwing so routes can answer with a useful 400.
 */
export function resolveNetwork(
  queryValue: string | null,
  bodyValue: unknown,
): { network: NetworkId } | { error: 'conflict' | 'unknown'; got: unknown } {
  if (bodyValue !== undefined && bodyValue !== null && typeof bodyValue !== 'string') {
    return { error: 'unknown', got: bodyValue }
  }
  const body = typeof bodyValue === 'string' ? bodyValue : null

  if (queryValue !== null && body !== null && queryValue !== body) {
    return { error: 'conflict', got: { query: queryValue, body } }
  }
  const chosen = queryValue ?? body
  if (chosen === null) return { network: DEFAULT_NETWORK }
  if (!isNetworkId(chosen)) return { error: 'unknown', got: chosen }
  return { network: chosen }
}

/** One network as served to agents, priced for this request. */
export function acceptEntry(network: NetworkConfig, price: Price, payTo: string | null) {
  return {
    network: network.id,
    name: network.name,
    scheme: 'exact',
    chain: network.chain,
    chain_id: network.chainId,
    rpc: network.rpc,
    explorer: network.explorer,
    native_currency: network.nativeCurrency,
    asset: network.asset.symbol,
    asset_address: network.asset.address,
    asset_decimals: network.asset.decimals,
    asset_address_verified: network.asset.verified,
    amount: price.amount,
    amount_atomic: price.amountAtomic,
    pay_to: payTo,
    facilitator: network.facilitator,
    settlement: network.settlement,
    ...(network.asset.note ? { note: network.asset.note } : {}),
    ...(network.settlement === 'unavailable'
      ? {
          settlement_note:
            'Advertised for network coverage. No x402 facilitator is confirmed for this chain, so a payment here cannot be settled yet — use demo (fake) pay, or pay on base-sepolia.',
        }
      : {}),
  }
}

/** Every selectable network, default first, priced identically in USDC units. */
export function acceptsList(price: Price, payTo: string | null) {
  return networkList().map((n) => acceptEntry(n, price, payTo))
}

/** Network summary without prices, for discovery documents. */
export function networkSummaries() {
  return networkList().map((n) => ({
    network: n.id,
    name: n.name,
    chain: n.chain,
    chain_id: n.chainId,
    rpc: n.rpc,
    explorer: n.explorer,
    native_currency: n.nativeCurrency,
    asset: n.asset.symbol,
    asset_address: n.asset.address,
    asset_decimals: n.asset.decimals,
    asset_address_verified: n.asset.verified,
    facilitator: n.facilitator,
    settlement: n.settlement,
    default: n.id === DEFAULT_NETWORK,
    ...(n.asset.note ? { note: n.asset.note } : {}),
  }))
}
