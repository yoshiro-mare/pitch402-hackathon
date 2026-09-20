# Pitch402

Agent-native paid playlist pitching on Base + x402 + Spotify.
Hackathon project in AEG_HACKATHON.

## Product
A curator opens a 100-spot playlist.
An artist or agent buys a numbered spot with USDC via x402.
Buying a spot places the track on the curator's own Spotify playlist.

Default prices in USDC, editable per cycle without redeploy:
- spot 1 = 10
- spots 2-3 = 5
- spots 4-10 = 3
- spots 11-100 = 1

Terms (editable multipliers): cycle=1x, 3m=3x, 1y=10x
Price is snapshotted at payment. Never reprice a paid spot.
When a spot is taken, API returns the next free spot + price.
When 100 spots are filled, close buys and open next-cycle waitlist.
3m/1y reservations roll into the next cycle.

## Agent-first API (source of truth)
- GET /api/v1/playlists
- GET /api/v1/playlists/:id
- GET /api/v1/playlists/:id/quote?spot=N or ?next=1
- POST /api/v1/playlists/:id/spots/:n   (x402 gated)
- GET /api/v1/receipts/:id
- GET /.well-known/agent.json
- GET /llms.txt

Artist never OAuths. Curator OAuths once to write to THEIR Spotify playlist.
We never claim Spotify editorial playlists.
We never invent stream counts. Spotify Web API has no playlist-attributed plays or royalties.
Dashboard shows: spot, amount paid, term, added_at, playlist followers, receipt.
Estimates only if curator later uploads Spotify for Artists data, and must be labeled Estimate.

## Stack
- App: Next.js + TypeScript
- Payments: x402. Two testnets, default base-sepolia. Never mainnet.

### Networks (source of truth: config/pitch402.config.ts)
1. Base Sepolia — DEFAULT, settlement live
   - caip2 eip155:84532, chainId 84532
   - USDC 0x036CbD53842c5426634e7929541eC2318f3dCF7e
     VERIFIED 2026-09-19 by eth_call on chain 84532: symbol() USDC, name() USDC,
     decimals() 6, EIP-712 version() 2, contract has code. Matches @x402/evm.
     The old value here ended 634e7926541e and has no contract on Base Sepolia.
   - facilitator https://x402.org/facilitator
2. HashKey Chain Testnet — advertised, settlement unavailable
   - caip2 eip155:133, chainId 133 (RPC confirmed live 2026-09-20)
   - rpc https://testnet.hsk.xyz, explorer https://testnet-explorer.hsk.xyz
   - native HSK
   - facilitator: NONE confirmed. x402.org lists eip155:84532 + Solana only.
     Never claim x402.org settles HSK.
   - asset: TBD. No testnet stablecoin address verified onchain — left null in
     config rather than guessed. Spots cannot be bought on this network: a POST
     selecting it returns 402 settlement_unavailable_on_network.
     Do NOT use HashKey mainnet USDC.e here.

Client picks a network with ?network=base-sepolia|hsk-testnet or body "network".
Default stays base-sepolia. Receipts record the network chosen.
- Contracts: Foundry, ONE contract for inventory + receipts. No token. No AMM.
- Spotify Web API: create/read/add items on curator-owned playlist only

## Build order
1. API + quote + real x402
2. Inventory rules + configurable tiers
3. Foundry contract
4. Minimal curator/artist UI
5. Spotify write
6. Agent script
7. README + docs/TECH.md for submission

## Do not
- Do not create a token
- Do not scrape Spotify
- Do not start on Base mainnet
- Do not use HashKey mainnet
- Do not claim any facilitator settles HashKey Chain Testnet
- Do not add Tempo. Do not add Ethereum mainnet
- Do not put private keys in git
- Do not promise guaranteed Spotify algorithm streams
- Say "onchain" not "on-chain"

Before writing Solidity, read ethskills ship + security + testing + tools.
Before deploying, use Foundry forge test.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
