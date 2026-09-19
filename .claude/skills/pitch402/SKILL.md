---
name: pitch402
description: Pitch402 product rules — 100-spot paid playlist pitching on Base + x402 + Spotify. Use when working on pricing, inventory, the agent API, Spotify integration, metrics, or contracts in this project.
---

# Pitch402

Agent-native paid playlist pitching on Base + x402 + Spotify.

## Product
- A curator opens a 100-spot playlist.
- An artist or agent buys a numbered spot with USDC via x402.
- Buying a spot places the track on the curator's own Spotify playlist.

## Prices (USDC defaults, editable per cycle without redeploy)
| Spot | Price |
|------|-------|
| 1 | 10 |
| 2-3 | 5 |
| 4-10 | 3 |
| 11-100 | 1 |

Term multipliers (editable): cycle = 1x, 3m = 3x, 1y = 10x.

Rules:
- Price is snapshotted at payment. Never reprice a paid spot.
- When a spot is taken, the API returns the next free spot + its price.
- When all 100 spots are filled, close buys and open the next-cycle waitlist.
- 3m/1y reservations roll into the next cycle.

## Agent API (source of truth)
- `GET /api/v1/playlists`
- `GET /api/v1/playlists/:id`
- `GET /api/v1/playlists/:id/quote?spot=N` or `?next=1`
- `POST /api/v1/playlists/:id/spots/:n` — x402 gated
- `GET /api/v1/receipts/:id`
- `GET /.well-known/agent.json`
- `GET /llms.txt`

## Spotify honesty rules
- Artist never OAuths. Curator OAuths once, only to write to THEIR own playlist.
- Never claim Spotify editorial playlists.
- Never invent stream counts. The Spotify Web API has no playlist-attributed plays or royalties.
- Dashboard shows only: spot, amount paid, term, added_at, playlist followers, receipt.
- Estimates only if the curator uploads Spotify for Artists data, and always labeled **Estimate**.
- Never promise guaranteed algorithmic streams. Never scrape Spotify.

## Contracts
- ONE contract only, for inventory + receipts. Foundry.
- No token. No AMM. Base Sepolia first, never mainnet to start.
