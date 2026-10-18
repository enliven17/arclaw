# arclaw

Pay USDC on Arc, play a 3D claw machine, win a sealed box. A box opens into a pack of three cards, and every card is a
real tokenized stock (an Astock `.arc` token). The claw is theatre; a smart contract decides the contents with verifiable
randomness. Product rules live in [`CLAUDE.md`](CLAUDE.md), the odds and treasury in [`docs/TOKENOMICS.md`](docs/TOKENOMICS.md).

Live: https://arclaw.app (testnet until the mainnet launch). X: https://x.com/arclawapp

## Stack

| | |
|---|---|
| Web | Next 16 (App Router), React 19, Tailwind v4, GSAP and Lenis, Vercel (with Web Analytics) |
| Wallets | Privy (email, Google, X, external wallets) on top of viem |
| Backend | Convex (leaderboard indexer, keeper cron), Telegram bot (`app/api/telegram`) |
| Contracts | Solidity 0.8.28, Foundry, in `contracts/` |
| Randomness | D20DAO VRF on Arc (`contracts/src/vrf`) |
| Stocks | Astock tokens, desk and oracle on Arc mainnet; mocks on testnet |

## Layout

```
app/              routes: landing (/), the app (/app/*), claim, pull share pages, whitepaper and legal, api
components/       landing, app, claw machine, motion, wallet, pack, seo
lib/              arc config, contract client and ABIs (lib/abi), machines and odds, keeper, share signing
convex/           schema, leaderboard indexer, keeper crons
contracts/        src, script (deploy), test (unit, invariant, audit1 to audit6 findings), lib
scripts/          dev (screenshots, profiling), assets (logos, cabinet art), ops (telegram), mainnet (keys, safes, deploy), keeper
public/           logos, cabinet art (generated), video, sfx
brand/            logo sources and the launch video source
docs/             tokenomics, security, deployment, operations
e2e/              local end to end checks against a deployed contract
proxy.ts          region gate (451 for restricted countries on /app and /claim)
```

## Run it

```sh
pnpm install
cp .env.example .env.local      # fill in what you need; nothing is required to browse the site
pnpm dev                        # http://localhost:3000
pnpm typecheck && pnpm lint && pnpm build
```

Contracts:

```sh
cd contracts
forge build && forge test       # unit, invariant and audit tests
node script/export-abi.mjs      # regenerate lib/abi after a contract change
```

Generated assets: `pnpm cabinet` rewrites `public/cabinet/*.svg` after the cabinet art or `claw.css` changes (needs a local
Chromium through playwright-core). `pnpm shots` takes screenshots for design review (see `scripts/dev`).

## Environment

See [`.env.example`](.env.example). The ones that matter:

| Variable | Where | What |
|---|---|---|
| `NEXT_PUBLIC_ARC_NETWORK` | Vercel | `testnet` (default) or `mainnet` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Vercel | Privy app; without it Connect says wallets are off |
| `NEXT_PUBLIC_CONVEX_URL` | Vercel | the Convex deployment for the leaderboard |
| `APP_ORIGIN` | Vercel | public origin for metadata and share cards |
| `SHARE_SECRET` | Vercel | signs shared-pull links (`openssl rand -hex 32`), server only |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Vercel | the bot |
| `BLOCKED_COUNTRIES` | Vercel | optional, replaces the default region list in `proxy.ts` |
| `KEEPER_PRIVATE_KEY`, `ALERT_TELEGRAM_CHAT_ID` | Convex | the keeper bot (a hot key that only holds gas) |

## Docs

- [`docs/TOKENOMICS.md`](docs/TOKENOMICS.md): machines, odds, treasury rules, the ARCLAW token.
- [`docs/SECURITY.md`](docs/SECURITY.md): threat model, roles and keys, what was reviewed, what is still open.
- [`docs/DEPLOY.md`](docs/DEPLOY.md): the mainnet runbook, testnet deploys, Convex and Vercel.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md): the keeper, alerts, runbooks.
- The whitepaper is a page of the site: `/whitepaper` (`app/(legal)/whitepaper`).

## Conventions

Commits are `type: subject`, no body. The design rules (no em dashes, one accent colour per screen, no gradients or glow)
are in [`DESIGN.md`](DESIGN.md) and [`CLAUDE.md`](CLAUDE.md). Every contract change gets two independent reviews and green
tests before any deploy.
