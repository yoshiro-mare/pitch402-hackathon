import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { NETWORKS, PAY_TO, type NetworkConfig, type NetworkId } from '@/config/pitch402.config'
import { markReceiptSettled } from '@/lib/store'
import { db, dbEnabled } from '@/lib/db'

type X402Globals = {
  server?: x402ResourceServer
  ready?: Promise<void>
  /**
   * resource URL -> receipt id, so a settlement can find what it paid for.
   * Only used when Supabase is not configured; with it, the mapping lives in
   * the settlements table so any instance can resolve a settlement.
   */
  pending?: Map<string, string>
}

/**
 * Held on globalThis for the same reason the store is: Next bundles each route
 * separately, and one facilitator sync per process is plenty.
 */
const globalForX402 = globalThis as unknown as { __pitch402X402?: X402Globals }
const x402 = (globalForX402.__pitch402X402 ??= {})

const pending = (x402.pending ??= new Map<string, string>())

/**
 * Networks x402 can actually charge on: a facilitator exists and we know the
 * asset address. HashKey Chain Testnet is advertised in quotes but has no
 * facilitator, so it is not registered here and no payment is ever claimed.
 */
export function settlementNetworks(): NetworkConfig[] {
  return Object.values(NETWORKS).filter(
    (n) => n.settlement === 'live' && n.facilitator !== null && n.asset.address !== null,
  )
}

export function canSettle(network: NetworkConfig): boolean {
  return network.settlement === 'live' && network.facilitator !== null && network.asset.address !== null
}

export const resourceServer: x402ResourceServer = (x402.server ??= buildServer())

function buildServer(): x402ResourceServer {
  const live = settlementNetworks()
  // Every settleable network today shares one facilitator; the first is used
  // as the client, and each network registers the exact-EVM scheme.
  const facilitatorUrl = live[0]?.facilitator ?? 'https://x402.org/facilitator'
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl }))

  for (const network of live) {
    server.register(network.chain, new ExactEvmScheme())
  }

  // The hook that learns the transaction hash only has the resource URL to go
  // on, so the sale it belongs to is looked up by that.
  server.onAfterSettle(async (context) => {
    const resource = resourceFrom(context)
    if (!resource) return
    const receiptId = await takePendingSettlement(resource)
    if (!receiptId) return
    const result = context.result as { success?: boolean; transaction?: string } | undefined
    await markReceiptSettled(receiptId, result?.transaction ?? null)
  })

  return server
}

/** Dig the request path out of the loosely typed transport context. */
function resourceFrom(context: { transportContext?: unknown }): string | null {
  const transport = context.transportContext as
    | { request?: { path?: string; adapter?: { getUrl?: () => string } } }
    | undefined
  const url = transport?.request?.adapter?.getUrl?.()
  if (typeof url === 'string' && url) return url
  const path = transport?.request?.path
  return typeof path === 'string' && path ? path : null
}

/**
 * Both the full URL and the bare path are recorded, because the settlement
 * hook reports whichever the transport happened to carry.
 *
 * The query string is always stripped. A spot is bought at a URL carrying
 * `?term=&network=`, but the resource it pays for is the path — so a resource
 * is remembered and claimed under the same key regardless of how the buyer
 * spelled the request.
 */
function resourceKeys(resource: string): string[] {
  const keys: string[] = []
  try {
    const url = new URL(resource)
    keys.push(`${url.origin}${url.pathname}`, url.pathname)
  } catch {
    // Not a full URL. Drop any query off the raw value by hand.
    keys.push(resource.split('?')[0])
  }
  return [...new Set(keys)]
}

/** Remember which receipt a settlement belongs to, by resource URL and path. */
export async function rememberPendingSettlement(resource: string, receiptId: string): Promise<void> {
  const keys = resourceKeys(resource)
  if (!dbEnabled()) {
    for (const key of keys) pending.set(key, receiptId)
    return
  }
  await db()
    .from('settlements')
    .upsert(keys.map((key) => ({ resource: key, receipt_id: receiptId })))
}

/**
 * Claim the receipt a settlement belongs to, removing the mapping.
 *
 * Looked up by every key the resource could have been stored under, not by the
 * raw string the hook handed us. The Next adapter reports `request.url`, which
 * carries the query string the buyer posted with; the mapping was written from
 * the bare resource. Matching on one exact string missed every time.
 */
async function takePendingSettlement(resource: string): Promise<string | null> {
  const keys = resourceKeys(resource)
  if (!dbEnabled()) {
    const key = keys.find((k) => pending.has(k))
    const receiptId = key ? (pending.get(key) ?? null) : null
    if (receiptId) {
      for (const [k, v] of pending) if (v === receiptId) pending.delete(k)
    }
    return receiptId
  }
  const { data } = await db().from('settlements').select('receipt_id').in('resource', keys).limit(1)
  const receiptId = (data as { receipt_id?: string }[] | null)?.[0]?.receipt_id ?? null
  if (receiptId) await db().from('settlements').delete().eq('receipt_id', receiptId)
  return receiptId
}

/**
 * Fetch supported kinds from the facilitator once per process. A failure is
 * not cached — the facilitator being down for one request should not disable
 * payments until the server restarts.
 */
export function ensureX402Ready(): Promise<void> {
  return (x402.ready ??= resourceServer.initialize().catch((err: unknown) => {
    x402.ready = undefined
    throw err
  }))
}

/** A payout address must be configured before we can quote a real payment. */
export function payTo(): string | null {
  if (!PAY_TO) return null
  const value = PAY_TO.trim()
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? value : null
}

export function x402Enabled(): boolean {
  return payTo() !== null
}

/**
 * Price as an exact stablecoin amount rather than a "$1.00" string, so buyers
 * are charged the tier price directly with no conversion step. `extra` carries
 * the EIP-712 domain the exact-evm scheme signs over, read off the verified
 * contract. Only called for networks that can settle, so the asset is known.
 */
export function assetPrice(network: NetworkConfig, amountAtomic: string) {
  if (!network.asset.address || !network.asset.eip712) {
    throw new Error(`no verified asset configured for ${network.id}`)
  }
  return {
    asset: network.asset.address,
    amount: amountAtomic,
    extra: { name: network.asset.eip712.name, version: network.asset.eip712.version },
  }
}

export type { NetworkId }
