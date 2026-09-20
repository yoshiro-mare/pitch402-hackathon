import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { PAYMENT } from '@/config/pitch402.config'
import { markReceiptSettled } from '@/lib/store'

type X402Globals = {
  server?: x402ResourceServer
  ready?: Promise<void>
  /** resource URL -> receipt id, so a settlement can find what it paid for */
  pending?: Map<string, string>
}

/**
 * Held on globalThis for the same reason the store is: Next bundles each route
 * separately, and one facilitator sync per process is plenty.
 */
const globalForX402 = globalThis as unknown as { __pitch402X402?: X402Globals }
const x402 = (globalForX402.__pitch402X402 ??= {})

const pending = (x402.pending ??= new Map<string, string>())

export const resourceServer: x402ResourceServer = (x402.server ??= buildServer())

function buildServer(): x402ResourceServer {
  const server = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: PAYMENT.facilitator }),
  ).register(PAYMENT.chain, new ExactEvmScheme())

  // Settlement finishes after the response is handed back, so the transaction
  // hash arrives here rather than in the route handler.
  server.onAfterSettle(async (context) => {
    const resource = resourceFrom(context)
    if (!resource) return
    const receiptId = pending.get(resource)
    if (!receiptId) return
    pending.delete(resource)
    const result = context.result as { success?: boolean; transaction?: string } | undefined
    markReceiptSettled(receiptId, result?.transaction ?? null)
  })

  return server
}

/** Dig the request path out of the loosely typed transport context. */
function resourceFrom(context: { transportContext?: unknown }): string | null {
  const transport = context.transportContext as { request?: { path?: string; adapter?: { getUrl?: () => string } } } | undefined
  const url = transport?.request?.adapter?.getUrl?.()
  if (typeof url === 'string' && url) return url
  const path = transport?.request?.path
  return typeof path === 'string' && path ? path : null
}

/** Remember which receipt a settlement belongs to, by resource URL and path. */
export function rememberPendingSettlement(resource: string, receiptId: string): void {
  pending.set(resource, receiptId)
  try {
    pending.set(new URL(resource).pathname, receiptId)
  } catch {
    // resource is not a full URL; the raw value above is enough
  }
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
  const value = PAYMENT.payTo
  if (!value) return null
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim()) ? value.trim() : null
}

export function x402Enabled(): boolean {
  return payTo() !== null
}

/**
 * Price as an exact USDC amount rather than a "$1.00" string, so buyers are
 * charged the tier price in USDC with no conversion step. `extra` carries the
 * EIP-712 domain the exact-evm scheme signs over — both values read off the
 * verified contract (name "USDC", version "2").
 */
export function usdcPrice(amountAtomic: string) {
  return {
    asset: PAYMENT.assetAddress,
    amount: amountAtomic,
    extra: { name: PAYMENT.eip712Name, version: PAYMENT.eip712Version },
  }
}
