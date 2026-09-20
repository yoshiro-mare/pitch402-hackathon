# Privy in Pitch402

Written for: whoever picks up the buyer side of this repo, and the judges reading how the pieces fit.

## Where Privy sits

Pitch402 is an x402 **resource server**. It answers `402 Payment Required`, verifies a payment, and
sells a numbered playlist spot. It has no wallet and wants none.

Privy is the **other side of the same handshake**: the wallet that can answer a 402 without a human
in the loop. Nothing in `app/` or `lib/` imports Privy. Everything Privy touches lives in `agent/`.

```
agent/ (Privy wallet)  --POST-->  /api/v1/playlists/demo/spots/7
                       <--402---  payment requirements: 3 USDC, Base Sepolia, pay_to 0x...
  signs EIP-3009 authorization (Privy enclave, policy-checked)
                       --POST-->  same request + X-PAYMENT header
                       <--201---  receipt, spot taken
                                  facilitator settles onchain, tx hash lands on the receipt
```

Both sides are already ours end to end, and neither knows anything about the other beyond HTTP.

## The three things Privy gives us that a raw private key does not

**1. A wallet with no key in the repo.** The agent holds a wallet id, not a secret. Signing happens
in Privy's TEE. `.env.local` never contains anything that can move money on its own.

**2. Policy enforced below the agent.** This is the part worth demoing. An x402 payment is an
EIP-3009 `transferWithAuthorization` signed as EIP-712 typed data — it is *not* an
`eth_sendTransaction`, so an ordinary transaction policy does not see it at all. The policy in
[agent/setup-wallet.ts](../agent/setup-wallet.ts) sits on `eth_signTypedData_v4` and reads the
recipient straight out of the message:

| Condition | Effect |
| --- | --- |
| domain `chainId` = 84532 | Base Sepolia only |
| domain `verifyingContract` = verified USDC | no lookalike token |
| message `to` = `PITCH402_PAY_TO` | can pay Pitch402 and nobody else |
| message `value` ≤ cap | per-payment ceiling |

Privy denies any method no rule allows, so that one ALLOW rule is the agent's entire capability. A
compromised agent process cannot drain the wallet — it can only overpay Pitch402, up to the cap.

**3. Caps on both sides of the trust boundary.** `agent/privy.ts` also sets x402 client spend
controls. That one is advisory — it is in the process an attacker would already own. The Privy
policy is the one that actually holds. Both exist because the client-side cap gives a clean error
on a bad quote, and the enclave cap gives a guarantee.

## Setup

1. Create an app at [dashboard.privy.io](https://dashboard.privy.io), copy the app ID and secret.
2. Fill `PRIVY_APP_ID` and `PRIVY_APP_SECRET` in `.env.local` (see `.env.example`).
3. `npm run agent:setup` — creates the policy and the wallet, prints the wallet id and address.
4. Paste `PITCH402_AGENT_WALLET_ID` and `PITCH402_AGENT_ADDRESS` back into `.env.local`.
5. Fund the address with Base Sepolia USDC from [faucet.circle.com](https://faucet.circle.com).
   No ETH needed — the x402 facilitator pays gas.
6. `npm run dev`, then in another shell:

```
npm run agent:buy -- --next --track spotify:track:4cOdK2wGLETKBW3PvgPWqT
npm run agent:buy -- --spot 7 --term 3m --track spotify:track:...
```

## Implementation notes

**We do not use `@privy-io/node/x402`.** `createX402Client` is the documented entry point, but it
eagerly imports `@x402/svm` and `@solana/kit`, which would pull Solana into an EVM-only project.
`agent/privy.ts` does exactly what that helper does for an EVM address — wrap the wallet as a viem
`LocalAccount` with `createViemAccount`, register the exact EVM scheme — and nothing more. If the
project ever wants Solana, switch to the helper and install the two peers.

**The scheme is pinned to one network.** `registerExactEvmScheme` defaults to an `eip155:*`
wildcard, which would let the agent sign for any EVM chain a server asked it to. We pass
`networks: ['eip155:84532']`.

**The x402 client's default spend cap is $1.** Spot 1 costs 10 USDC, so leaving the default in
place would refuse the top spot client-side before Privy ever saw the request.

**The typed-data types map must match byte for byte.** A Privy `ethereum_typed_data_message`
condition only evaluates when the `types` map in the policy matches the signing request exactly,
field order included. On a mismatch the condition is false, the ALLOW rule stops matching, and
every payment is denied by default. That fails closed, which is the right direction, but it is the
first thing to check if payments suddenly stop. The map in `agent/setup-wallet.ts` is the one the
Privy x402 clients send (`TransferWithAuthorization` only, no `EIP712Domain` entry) — a viem
`WalletClient` wired to Privy directly sends a different one.

## What this does not do yet

- **No browser wallet for artists.** `@privy-io/react-auth` ships `useX402Fetch`, which is the same
  flow from a React component with an email-login embedded wallet — an artist buys a spot without
  ever seeing a seed phrase. That is the obvious next step for the artist UI and it is not built.
- **Curator payouts stay manual.** Privy has fiat payouts (crypto in a wallet → a bank account in
  one API call). A curator cashing out USDC without touching an exchange is a real product feature
  and a bigger lift than the hackathon needs.
- **No wallet per buyer.** One agent wallet, one policy. Pregenerated per-artist wallets sharing a
  single policy id is a one-line change to `setup-wallet.ts` if the demo wants a fleet.

## Reference

- [Agent wallets](https://docs.privy.io/wallets/overview/solutions/agent-wallets.md)
- [Agentic wallets recipe](https://docs.privy.io/recipes/agent-integrations/agentic-wallets.md)
- [x402 with Privy](https://docs.privy.io/recipes/agent-integrations/x402.md)
- [Screening x402 payments with policies](https://docs.privy.io/recipes/agent-integrations/x402-sanctions-screening.md)
  — where the typed-data policy shape above comes from
- [Policies overview](https://docs.privy.io/controls/policies/overview.md)
- [Node SDK setup](https://docs.privy.io/basics/nodeJS/setup.md)
- Full docs index: <https://docs.privy.io/llms.txt>
