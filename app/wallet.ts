'use client'

/**
 * Paying a Pitch402 402 from a browser wallet.
 *
 * Same protocol the headless agent speaks, different signer. The agent holds
 * its own key and signs unattended; here a person approves each signature in
 * MetaMask. Neither needs an account with us — the only difference is who
 * clicks.
 *
 * Worth knowing: the signature is an EIP-3009 `transferWithAuthorization`, not
 * a transaction. The wallet never broadcasts anything, so the buyer needs USDC
 * but no ETH, and the popup they approve says "signature request" rather than
 * asking them to confirm gas.
 */
import { createPublicClient, createWalletClient, custom, http, type Hex } from 'viem'
import { baseSepolia } from 'viem/chains'
import { toClientEvmSigner } from '@x402/evm'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from '@x402/fetch'

export const BASE_SEPOLIA_CAIP2 = 'eip155:84532'
export const BASE_SEPOLIA_HEX = '0x14a34'
export const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, handler: (...args: never[]) => void): void
  removeListener?(event: string, handler: (...args: never[]) => void): void
}

export function injected(): Eip1193 | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null
}

export class WalletError extends Error {}

/** Ask for accounts, then make sure we are on the only chain that settles. */
export async function connect(): Promise<Hex> {
  const provider = injected()
  if (!provider) {
    throw new WalletError('No browser wallet found. Install MetaMask, or use the agent script.')
  }

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as Hex[]
  const address = accounts[0]
  if (!address) throw new WalletError('No account was shared.')

  const chainId = (await provider.request({ method: 'eth_chainId' })) as string
  if (chainId.toLowerCase() !== BASE_SEPOLIA_HEX) {
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_SEPOLIA_HEX }],
      })
    } catch (err) {
      // 4902: the wallet does not know this chain yet. Offer to add it rather
      // than telling the buyer to go and configure a network by hand.
      if ((err as { code?: number }).code !== 4902) throw err
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: BASE_SEPOLIA_HEX,
            chainName: 'Base Sepolia',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://sepolia.base.org'],
            blockExplorerUrls: ['https://sepolia.basescan.org'],
          },
        ],
      })
    }
  }
  return address
}

const publicClient = () => createPublicClient({ chain: baseSepolia, transport: http() })

/** USDC balance in whole units, for telling a buyer why a payment would fail. */
export async function usdcBalance(address: Hex): Promise<number> {
  const raw = (await publicClient().readContract({
    address: USDC,
    abi: [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ],
    functionName: 'balanceOf',
    args: [address],
  })) as bigint
  return Number(raw) / 1e6
}

/**
 * A fetch that answers 402 by signing with the connected wallet.
 *
 * `maxAmountPerPayment` is set from the quoted price rather than left at the
 * client's $1 default, which would silently refuse anything above spot 11. The
 * network list is explicit for the same reason it is in the agent: the
 * wildcard would sign on whatever chain a server named.
 */
export function payingFetch(address: Hex, maxUsdc: string): typeof fetch {
  const provider = injected()
  if (!provider) throw new WalletError('No browser wallet found.')

  const wallet = createWalletClient({ account: address, chain: baseSepolia, transport: custom(provider) })

  const signer = toClientEvmSigner(
    {
      address,
      signTypedData: (message) =>
        wallet.signTypedData({
          account: address,
          domain: message.domain,
          types: message.types,
          primaryType: message.primaryType,
          message: message.message,
        } as Parameters<typeof wallet.signTypedData>[0]),
    },
    publicClient(),
  )

  const client = new x402Client()
  client.setSpendControls({ maxAmountPerPayment: `$${maxUsdc}` })
  registerExactEvmScheme(client, { signer, networks: [BASE_SEPOLIA_CAIP2] })
  return wrapFetchWithPayment(fetch, client)
}

/** Human-readable reason a wallet refused, instead of a raw RPC error object. */
export function explain(err: unknown): string {
  const e = err as { code?: number; shortMessage?: string; message?: string }
  if (e?.code === 4001) return 'You rejected the signature in your wallet.'
  return e?.shortMessage ?? e?.message ?? 'Payment failed.'
}

export const EXPLORER = 'https://sepolia.basescan.org'

/**
 * The settlement transaction hash.
 *
 * Settlement runs after the handler returns, so the hash cannot be in the JSON
 * body — it arrives in this header instead. Cross-origin callers can read it
 * because the middleware names it in access-control-expose-headers.
 */
export function settlementTx(res: Response): string | null {
  const header = res.headers.get('payment-response')
  if (!header) return null
  try {
    const decoded = decodePaymentResponseHeader(header) as { transaction?: string } | null
    return decoded?.transaction ?? null
  } catch {
    return null
  }
}
