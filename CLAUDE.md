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
- Payments: x402 on Base Sepolia first (eip155:84532), facilitator https://x402.org/facilitator
- USDC Sepolia: 0x036CbD53842c5426634e7926541eC2318f3dCF7e
  WAIT verify this address against https://ethskills.com/addresses/SKILL.md before using
- Contracts: Foundry, ONE contract for inventory + receipts. No token. No AMM.
- Spotify Web API: create/read/add items on curator-owned playlist only

## Build order
1. API + quote + fake then real x402
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
- Do not put private keys in git
- Do not promise guaranteed Spotify algorithm streams
- Say "onchain" not "on-chain"

Before writing Solidity, read ethskills ship + security + testing + tools.
Before deploying, use Foundry forge test.
