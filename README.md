# Pitch402

**Paid playlist pitching that an AI agent can complete on its own, with no human in the loop.**

A curator opens a playlist with 100 numbered spots. An artist — or the agent working on their behalf —
buys a spot with USDC over [x402](https://x402.org), the HTTP 402 payment protocol, on Base Sepolia.
Buying a spot places the track on the curator's own Spotify playlist.

The API is the product. Every step (browse, quote, pay, receipt) is a plain HTTP call that returns the
exact URL to call next, so an agent needs no scraping, no login, and no human approval to pitch a track.

---

## Who it is for

**AI musicians and music agents.** A growing share of new music is made by people working with AI, and
increasingly by agents acting for an artist. Those agents have money (a funded wallet) and a goal (get
this track heard) but no way to buy placement: every playlist pitching service on the market assumes a
human filling in a form and a credit card. Pitch402 gives an agent a priced, machine-readable inventory
it can transact against by itself.

**Curators with a real audience.** A curator who has built a following gets a way to price and sell
access to it without a middleman taking a cut or an account manager negotiating each placement. They
set the tier prices, they own the Spotify playlist, and payment lands in their wallet.

Both sides get the same guarantee: the price was agreed before payment, and the receipt proves what was
bought.

---

## Features

- **100 numbered spots per cycle.** Position is the product — spot 1 is worth more than spot 100.
- **Tiered pricing in USDC.** Spot 1 costs 10, spots 2–3 cost 5, spots 4–10 cost 3, spots 11–100 cost 1.
- **Term multipliers.** Buy for one cycle (1x), three months (3x) or a year (10x).
- **Curator-editable tiers.** Prices and multipliers live in config and change per cycle without redeploying a contract.
- **Price snapshotting.** The amount is fixed at payment. Changing the tiers later never reprices a spot someone already bought.
- **Sold-out handling.** Ask for a taken spot and the API answers with the next free spot, its price, and the URL to buy it.
- **x402 payments on Base Sepolia.** An unpaid request answers `402` with signed payment requirements; a paid one returns the receipt.
- **Agent discovery.** `/.well-known/agent.json` and `/llms.txt` describe the whole service to a crawling agent.
- **No wallet needed to evaluate.** A demo mode completes a purchase end to end with no wallet, for judging and local development.

---

## Install and run

Requires **Node 20 or newer** (built and tested on Node 24).

```bash
# with nvm
nvm install 24
nvm use 24

npm install
npm run dev
```

Open <http://localhost:3000>.

### Environment

Copy `.env.example` to `.env.local`. Nothing is required to run the demo; the values matter once you
take real payments.

```bash
# .env.local

# Address that receives USDC. Required before real x402 payments can be quoted.
PITCH402_PAY_TO=0xYourBaseSepoliaAddress

# Allows the demo fake-pay header outside development. Leave unset in production.
PITCH402_ALLOW_FAKE_PAY=1

# Optional. Absolute base URL used in quotes and receipts.
# PITCH402_BASE_URL=http://localhost:3000
```

Never put a private key in this file. The server only ever needs an address to be paid *to*; it never
holds a key and never signs a transaction.

---

## How to demo (about two minutes)

**1. Open the page.** <http://localhost:3000> shows the cycle, the next free spot and its price, and
all 100 spots tinted by tier with the taken ones greyed out.

**2. Buy a spot.** The form is prefilled with a real Spotify track URL and the next free spot. Pick a
term — the total updates live — and press **Buy (demo / fake pay)**. A receipt appears immediately and
the grid marks the spot sold. No wallet, no signup.

**3. Show the quote an agent would read.**

```bash
curl -s "http://localhost:3000/api/v1/playlists/demo/quote?next=1" | python3 -m json.tool
```

Point at `next_action.url` — the agent is told exactly where to POST next. Now ask for the spot you
just bought in step 2 (spot 1 unless you changed it) and the answer names the next free one instead:

```bash
curl -s "http://localhost:3000/api/v1/playlists/demo/quote?spot=1" | python3 -m json.tool
```

**4. Show the real payment demand.** Without the demo header, the same purchase endpoint answers 402
with x402 payment requirements:

```bash
curl -i -X POST http://localhost:3000/api/v1/playlists/demo/spots/2 \
  -H 'content-type: application/json' \
  -d '{"track_uri":"spotify:track:4cOdK2wGLETKBW3PvgPWqT"}'
```

Decode the `payment-required` header to see what an agent's wallet would sign:

```bash
curl -s -D - -o /dev/null -X POST http://localhost:3000/api/v1/playlists/demo/spots/2 \
  -H 'content-type: application/json' -d '{"track_uri":"spotify:track:4cOdK2wGLETKBW3PvgPWqT"}' \
  | grep -i '^payment-required:' | cut -d' ' -f2 | tr -d '\r' | base64 -d | python3 -m json.tool
```

```json
{
  "x402Version": 2,
  "resource": { "url": "http://localhost:3000/api/v1/playlists/demo/spots/2" },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "5000000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0xYourAddress",
    "maxTimeoutSeconds": 120,
    "extra": { "name": "USDC", "version": "2" }
  }]
}
```

**5. Show how an agent finds all of this unaided:** <http://localhost:3000/llms.txt> and
<http://localhost:3000/.well-known/agent.json>.

---

## Technical integration

**Payments — x402 on Base Sepolia.** The purchase endpoint is wrapped with the official `@x402/next`
resource server against the public facilitator at `https://x402.org/facilitator`, network
`eip155:84532`. Prices are quoted as exact USDC amounts rather than dollar strings, so no conversion
sits between the quoted price and the charged one. Settlement runs only after the handler succeeds, so
a spot that gets taken mid-request returns `409` and the buyer is never charged; if settlement then
fails, the spot is released and the receipt is deleted.

The Base Sepolia USDC address `0x036CbD53842c5426634e7929541eC2318f3dCF7e` was verified by `eth_call`
against chain 84532 before it was hardcoded: `symbol()` USDC, `decimals()` 6, EIP-712 `version()` 2.

**Spotify — planned, not connected.** The intended flow is the curator authorising once with OAuth so
the service can add tracks to a playlist they own. Artists never authorise anything. The service will
never touch Spotify editorial playlists, and it reports no stream counts, because the Spotify Web API
exposes no playlist-attributed plays or royalties.

**Agent endpoints.**

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/playlists` | List open cycles |
| `GET /api/v1/playlists/:id` | Cycle detail, tiers, sold spots |
| `GET /api/v1/playlists/:id/quote?spot=N` | Price one spot |
| `GET /api/v1/playlists/:id/quote?next=1` | Price the next free spot |
| `POST /api/v1/playlists/:id/spots/:n` | Buy a spot — x402 gated |
| `GET /api/v1/receipts/:id` | Receipt for a purchase |
| `GET /.well-known/agent.json` | Machine-readable service description |
| `GET /llms.txt` | Plain-language description for crawling agents |

**Stack.** Next.js 16 with TypeScript, the App Router, and no database. See
[docs/TECH.md](docs/TECH.md) for the architecture and roadmap.

---

## Honest limits

This is a hackathon build. What is not yet true:

- **The demo purchase is fake.** `X-PITCH402-FAKE-PAY: 1` completes a purchase with no wallet, no USDC
  transfer and nothing settled onchain. Receipts from it say so, in the receipt body itself. It exists
  so the product can be judged without funding a wallet, and it is disabled in production unless
  explicitly switched on.
- **The paid path is wired but unproven end to end.** The 402 challenge, the payment requirements, the
  per-spot pricing and the refusal to charge for a taken spot are all working and tested. A successful
  payment returning 201 has not been run against a funded wallet.
- **State is in memory.** Restarting the server clears every purchase. There is no database and no
  contract yet, so nothing survives a restart.
- **Nothing reaches Spotify.** A purchase records the track against the spot. It does not add the track
  to any playlist. The Spotify integration is designed but not built.
- **No token, no AMM, no mainnet.** Base Sepolia only.

We would rather show you a working payment demand and say plainly what is stubbed than claim a
placement pipeline that does not exist.
