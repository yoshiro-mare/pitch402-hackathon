# Pitch402 — Technical Overview

**Track: AI-Native Creator Economy & Digital Rights**

Pitch402 is priced, machine-readable playlist inventory that an AI agent can buy without a human.
A curator opens a 100-spot cycle; an artist's agent quotes a spot, pays in USDC over x402 on Base
Sepolia, and receives a receipt. The placement right is bought at a price both sides agreed in
advance, and the receipt records exactly what was purchased. HashKey Chain Testnet is quotable as a
second network.

Why this fits the track: an agent acting for a musician has a wallet and a goal but no commercial rail
to act on. Existing pitching services are human forms behind logins. Pitch402 turns playlist access
into an addressable, priced resource — the creator sets the price and keeps the revenue, and the
purchase produces a durable record of the terms.

---

## Architecture

```
                 ┌──────────────────────────────┐
  AI agent ─────▶│  Next.js App Router (API)    │
  or curator UI  │                              │
                 │  /api/v1/playlists           │  browse
                 │  /api/v1/playlists/:id/quote │  price
                 │  /api/v1/.../spots/:n        │  buy   ── x402 gate
                 │  /api/v1/receipts/:id        │  proof
                 │  /.well-known/agent.json     │  discovery
                 │  /llms.txt                   │
                 └───────┬──────────────┬───────┘
                         │              │
              pricing + inventory   @x402/next
              (config + store)      resource server
                         │              │
                         │              ▼
                         │      x402.org/facilitator
                         │      verify → settle
                         │              │
                         ▼              ▼
                 receipt record   Base Sepolia (eip155:84532) — settles live
                 (records the     HashKey Chain Testnet (eip155:133)
                  network used)   — advertised, no facilitator confirmed
```

**Layers**

| Layer | Files | Responsibility |
| --- | --- | --- |
| Config | `config/pitch402.config.ts` | Tiers, term multipliers, payment settings. The only file a curator edits to reprice a cycle. |
| Pricing | `lib/pricing.ts` | Tier lookup and USDC maths in `bigint` at 6 decimals. No floating point touches money. |
| Inventory | `lib/store.ts` | Spots, sales, receipts. Sale, release and settlement marking. |
| Payments | `lib/x402.ts` | x402 resource server, facilitator client, EVM exact scheme, settlement hook. Registers only networks that can actually settle. |
| Networks | `lib/networks.ts` | Network resolution from query or body, and the `accepts` list served in quotes and 402 bodies. |
| Validation | `lib/track.ts` | Normalises a Spotify track URI, URL or bare id. No network call. |
| API | `app/api/v1/**` | The seven endpoints below. |
| Demo UI | `app/page.tsx` | Judge-facing page. Reads the same public API an agent uses. |

**Design decisions worth calling out**

- **Price is snapshotted at payment.** The charged amount is stored on the sale and never recomputed.
  Editing the tiers afterwards cannot reprice a spot someone bought. This is verified by changing a
  tier live and confirming the existing receipt is unchanged.
- **Settlement runs after the handler succeeds.** A spot taken mid-request returns `409` before any
  charge. If settlement fails after verification, the spot is released and the receipt deleted, so
  inventory is never held against money that did not move.
- **Exact USDC amounts, not dollar strings.** Payment requirements quote `amount` in USDC's smallest
  unit with the asset address, so nothing converts between the quoted and charged price.
- **Every response carries the next action.** Quotes and errors include the exact URL to call next,
  which is what lets an agent proceed without a human reading documentation.
- **A network is advertised or settleable, never pretend.** Every quote and 402 lists both chains with
  an explicit `settlement` field. A chain with no confirmed facilitator returns
  `settlement_unavailable_on_network` and names what will work, instead of issuing payment
  requirements no facilitator would honour. An unverified asset address is served as `null`, never a
  guess — a wrong token address loses funds.
- **Contract-light by design.** Ownership and payment belong onchain; inventory rules, search and
  playlist metadata do not. The planned contract is one contract, for receipts.

---

## Key features

- 100 numbered spots per cycle, priced by position.
- Tier ladder and term multipliers editable per cycle without redeploying anything.
- Price snapshotting, so a paid spot is never repriced.
- Taken-spot handling that answers with the next free spot, its price and its buy URL.
- x402 payment gating on Base Sepolia with the public facilitator.
- Multi-network quoting: Base Sepolia and HashKey Chain Testnet, chosen per request, priced identically
  in USDC units, with the chosen network recorded on the receipt.
- Receipts addressable by URL, recording amount, term, track, time and settlement state.
- Agent discovery through `/.well-known/agent.json` and `/llms.txt`.
- A demo payment mode for evaluation without a wallet, clearly labelled as such in its own receipts.

---

## Agent API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/v1/playlists` | Open cycles with next free spot and price |
| `GET` | `/api/v1/playlists/:id` | Tiers, multipliers, sold spots, payment settings |
| `GET` | `/api/v1/playlists/:id/quote?spot=N` | Price one spot; `409` plus the next free spot if taken |
| `GET` | `/api/v1/playlists/:id/quote?next=1` | Price the next free spot |
| `GET` | `/api/v1/playlists/:id/quote?next=1&network=hsk-testnet` | Same quote, priced for a chosen network |
| `POST` | `/api/v1/playlists/:id/spots/:n` | Buy. `402` unpaid, `201` paid, `409` taken |
| `GET` | `/api/v1/receipts/:id` | Receipt for a purchase |
| `GET` | `/.well-known/agent.json` | Service, pricing and endpoint description |
| `GET` | `/llms.txt` | Same, in prose, for crawling agents |

**Buy request**

```http
POST /api/v1/playlists/demo/spots/2?term=3m
content-type: application/json

{ "track_uri": "spotify:track:4cOdK2wGLETKBW3PvgPWqT", "buyer": "agent-id" }
```

`track_uri` accepts a Spotify URI, an `open.spotify.com` URL, or a bare 22-character track id. `term`
and `network` may be sent in the query string or the body; for paid requests the query string is
authoritative, because the price is settled before the body is read. Sending both with conflicting
values returns `400`.

### Networks

| Network | id | CAIP-2 | Chain id | Asset | Settlement |
| --- | --- | --- | --- | --- | --- |
| Base Sepolia (default) | `base-sepolia` | `eip155:84532` | 84532 | USDC `0x036CbD…F7e`, verified onchain | Live via `x402.org/facilitator` |
| HashKey Chain Testnet | `hsk-testnet` | `eip155:133` | 133 | TBD — `null`, none verified | None confirmed |

Prices are the same USDC amounts on both. Every quote and 402 body carries a `payment.accepts` array
describing both networks, each with `settlement`, `asset_address`, `asset_address_verified`,
`facilitator` and the amount due. Receipts carry `payment.network`.

**402 response** carries a `payment-required` header (base64 x402 requirements: scheme `exact`, network
`eip155:84532`, exact USDC amount, asset address, `payTo`, EIP-712 domain) plus a readable JSON body
with the quote and the fake-pay hint.

---

## Pricing

| Spot | Price (USDC) |
| --- | --- |
| 1 | 10 |
| 2–3 | 5 |
| 4–10 | 3 |
| 11–100 | 1 |

| Term | Multiplier |
| --- | --- |
| `cycle` | 1x |
| `3m` | 3x |
| `1y` | 10x |

Amount charged = tier price × term multiplier, in USDC (6 decimals). Spot 1 for a year is 100 USDC;
spot 42 for a cycle is 1 USDC. Both tables live in `config/pitch402.config.ts` and are served to agents
through the API, so the demo page and `/llms.txt` follow any edit automatically.

---

## Built vs roadmap

### Built and verified

- Seven-endpoint agent API with next-action URLs throughout.
- Tier and term pricing with exact `bigint` USDC maths.
- Price snapshotting, proven by repricing a tier and confirming a paid receipt is untouched.
- Inventory rules: taken-spot rejection, next-free-spot lookup, cycle-full state.
- x402 `402` challenge with signed payment requirements, per-spot and per-term amounts.
- Base Sepolia USDC address verified onchain by `eth_call` before hardcoding — `symbol()` USDC,
  `decimals()` 6, EIP-712 `version()` 2. (The address originally planned for this project had no
  contract on Base Sepolia; it was one character off.)
- Two-network quoting with per-request selection, validation of unknown and conflicting values, and the
  network recorded on every receipt. HashKey Chain Testnet chain id 133 and RPC confirmed live.
- Refusal to charge for a taken spot, and spot release on settlement failure.
- Demo payment mode, disabled in production by default.
- Receipts with settlement state, addressable by URL.
- Judge-facing demo page driven entirely by the public API.

### Not yet done

| Item | Status | What it needs |
| --- | --- | --- |
| **HashKey settlement** | Blocked | An x402 facilitator that supports `eip155:133`, plus a testnet stablecoin address verified onchain. Until both exist, the network is advertised and demo-payable only. |
| **Real x402 settlement** | Wired, unproven | A funded Base Sepolia wallet to run verify → 201 → settle end to end. The `onAfterSettle` hook that writes the transaction hash onto the receipt has not fired against a real payment. |
| **Spotify OAuth write** | Designed, not built | Curator-only OAuth, token storage, and `POST /playlists/{id}/tracks` on a playlist the curator owns. Artists never authorise. |
| **Foundry receipt contract** | Not started | One contract for inventory and receipts. No token, no AMM. Unit and fuzz tests, `slither`, then Base Sepolia. |
| **Persistent state** | Not started | Purchases live in memory and are lost on restart. Needs a database, with the contract as the source of truth for what was paid. |
| **Cycle rollover** | Partially specified | Next-cycle waitlist when 100 spots fill, and rolling 3m/1y reservations into the following cycle. |
| **Curator dashboard** | Not started | Spot, amount, term, added-at, follower count, receipt. Estimates only from curator-uploaded Spotify for Artists data, always labelled as estimates. |

### Honest limit on network coverage

HashKey Chain Testnet is listed to meet the hackathon's chain requirement. Live facilitator settlement
is verified on Base Sepolia only. No facilitator is confirmed for chain 133 — `x402.org/facilitator`
advertised `eip155:84532` and Solana when checked on 2026-09-20 — and no testnet stablecoin address for
chain 133 could be verified onchain, so the asset is served as `null` rather than guessed. Demo
payments work on the network and receipts record it; nothing settles there.

### Deliberately out of scope

No token. No AMM. No mainnet deployment of any kind, HashKey mainnet included. No Tempo, no Ethereum
mainnet. No scraping of Spotify. No stream-count or royalty claims —
the Spotify Web API exposes no playlist-attributed plays, so any number of that kind would be invented.
No claims about editorial playlists or algorithmic reach: this sells a spot on a named curator's own
playlist, and nothing more.
