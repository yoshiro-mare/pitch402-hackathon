/**
 * Provision the Pitch402 buyer agent: one Privy wallet, one policy.
 *
 *   node --env-file=.env.local agent/setup-wallet.ts
 *
 * Run once. It prints a wallet id and address to paste back into .env.local,
 * then you fund that address with test USDC from https://faucet.circle.com.
 *
 * The policy is the interesting half. Privy evaluates it inside its enclave
 * before it signs anything, so it holds even if this script, the agent, or the
 * machine running them is compromised. An x402 payment is an EIP-3009
 * `transferWithAuthorization` signed as EIP-712 typed data — never an
 * `eth_sendTransaction` — so the rule has to sit on `eth_signTypedData_v4` and
 * read the recipient out of the message.
 *
 * Privy denies any method no rule allows, so this single ALLOW rule means the
 * agent can do exactly one thing with its money: pay Pitch402's payout address,
 * in USDC, on Base Sepolia, up to the cap. Not another payee, not another
 * chain, not a larger amount, not a plain transfer.
 */
import type { TypedDataInput } from '@privy-io/node/resources'
import { BASE_SEPOLIA_USDC, env, optionalEnv, privyClient } from './privy.ts'

/**
 * The EIP-712 types map the x402 EVM client sends, field order included. A
 * Privy typed-data condition only fires when this matches the signing request
 * exactly — a mismatch makes the condition false, the rule stops matching, and
 * every payment is denied by default. That fails closed, which is the right way
 * round, but it is also the first thing to check if payments start failing.
 */
const TRANSFER_WITH_AUTHORIZATION: TypedDataInput = {
  primary_type: 'TransferWithAuthorization',
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
}

async function main() {
  const privy = privyClient()
  const payTo = env('PITCH402_PAY_TO')
  // Spot 1 at the 1y term is the dearest thing on sale (10 x 10 = 100 USDC).
  // The default here covers a single cycle-term top spot and nothing grander.
  const maxUsdc = optionalEnv('PITCH402_AGENT_MAX_USDC') ?? '10'
  const maxAtomic = (BigInt(maxUsdc) * 1_000_000n).toString()

  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    throw new Error(`PITCH402_PAY_TO is not an EVM address: ${payTo}`)
  }

  const policy = await privy.policies().create({
    version: '1.0',
    name: 'Pitch402 buyer agent',
    chain_type: 'ethereum',
    rules: [
      {
        name: 'Pay Pitch402 spots on Base Sepolia',
        method: 'eth_signTypedData_v4',
        action: 'ALLOW',
        conditions: [
          // Base Sepolia only.
          { field_source: 'ethereum_typed_data_domain', field: 'chainId', operator: 'eq', value: '84532' },
          // Signed against the verified USDC contract, not some lookalike token.
          {
            field_source: 'ethereum_typed_data_domain',
            field: 'verifyingContract',
            operator: 'eq',
            value: BASE_SEPOLIA_USDC,
          },
          // Paying Pitch402 and nobody else.
          {
            field_source: 'ethereum_typed_data_message',
            typed_data: TRANSFER_WITH_AUTHORIZATION,
            field: 'to',
            operator: 'eq',
            value: payTo,
          },
          // Per-payment ceiling, in USDC's smallest unit.
          {
            field_source: 'ethereum_typed_data_message',
            typed_data: TRANSFER_WITH_AUTHORIZATION,
            field: 'value',
            operator: 'lte',
            value: maxAtomic,
          },
        ],
      },
    ],
  })

  const wallet = await privy.wallets().create({
    chain_type: 'ethereum',
    display_name: 'Pitch402 buyer agent',
    policy_ids: [policy.id],
  })

  console.log('Policy created')
  console.log('  id          ', policy.id)
  console.log('  allows      ', `USDC payments to ${payTo} on Base Sepolia, up to ${maxUsdc} USDC each`)
  console.log('  denies      ', 'everything else, including any other payee, chain, or method')
  console.log()
  console.log('Wallet created')
  console.log('  id          ', wallet.id)
  console.log('  address     ', wallet.address)
  console.log()
  console.log('Add these to .env.local:')
  console.log(`  PITCH402_AGENT_WALLET_ID=${wallet.id}`)
  console.log(`  PITCH402_AGENT_ADDRESS=${wallet.address}`)
  console.log()
  console.log('Then fund the address with Base Sepolia USDC: https://faucet.circle.com')
  console.log('It needs no ETH — the x402 facilitator pays the gas.')
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
