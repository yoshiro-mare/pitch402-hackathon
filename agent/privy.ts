/**
 * Shared Privy wiring for the Pitch402 agent scripts.
 *
 * Pitch402 is the x402 *resource server*: it answers 402 and gets paid. These
 * scripts are the other side — a buyer with a wallet that can answer a 402
 * without a human clicking anything. Privy supplies that wallet.
 *
 * Model 1 from Privy's agentic-wallets recipe: the wallet is owned by this
 * backend, not by an end user, so the agent can sign without a session. The
 * guardrails come from a Privy policy attached to the wallet, enforced inside
 * Privy's enclave — see agent/setup-wallet.ts.
 */
import { PrivyClient } from '@privy-io/node'
import { createViemAccount } from '@privy-io/node/viem'
import { x402Client } from '@x402/fetch'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import type { Hex } from 'viem'

/** Base Sepolia, the only chain Pitch402 can actually settle on today. */
export const BASE_SEPOLIA_CAIP2 = 'eip155:84532'

/**
 * USDC on Base Sepolia. Verified onchain — the same address config/pitch402.
 * config.ts carries. Repeated here rather than imported because these scripts
 * run under plain `node`, which does not know the `@/` path alias.
 */
export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

export function env(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`)
  }
  return value.trim()
}

export function optionalEnv(name: string): string | null {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : null
}

export function privyClient(): PrivyClient {
  return new PrivyClient({ appId: env('PRIVY_APP_ID'), appSecret: env('PRIVY_APP_SECRET') })
}

/**
 * An x402 client that pays from a Privy wallet on Base Sepolia.
 *
 * Privy ships `createX402Client` in `@privy-io/node/x402`, but that module
 * imports the Solana schemes eagerly, so using it would drag @solana/kit and
 * @x402/svm into an EVM-only project. This does the same two steps it does for
 * an EVM address — wrap the wallet as a viem LocalAccount, register the exact
 * EVM scheme — and nothing else.
 *
 * `maxAmountPerPayment` matters: the x402 client defaults to a $1 per-payment
 * cap, and spot 1 costs 10 USDC, so an uncapped-looking purchase would be
 * refused client-side before Privy ever saw it.
 */
export function payingClient(options: {
  privy: PrivyClient
  walletId: string
  address: Hex
  /** per-payment cap in whole USDC, e.g. "10" */
  maxUsdc: string
}): x402Client {
  const account = createViemAccount(options.privy, {
    walletId: options.walletId,
    address: options.address,
  })

  const client = new x402Client()
  client.setSpendControls({ maxAmountPerPayment: `$${options.maxUsdc}` })
  // Pinned to one network. Without `networks` the scheme registers a
  // eip155:* wildcard and the agent would sign for any EVM chain a server
  // asked it to.
  registerExactEvmScheme(client, { signer: account, networks: [BASE_SEPOLIA_CAIP2] })
  return client
}
