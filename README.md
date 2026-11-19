# arclaw

An arcade claw you play from your phone, stocked with tokenized stocks instead of plush toys. Pay Circle USDC on Solana,
steer the claw live on a MagicBlock ephemeral rollup, and every play wins a sealed box that opens into a pack of three
cards, each a real tokenized stock. The claw is theatre; MagicBlock VRF and the program's weighted tables decide the
pack. Product rules live in [`CLAUDE.md`](CLAUDE.md), the architecture in [`docs/SOLANA.md`](docs/SOLANA.md), the odds
and treasury in [`docs/TOKENOMICS.md`](docs/TOKENOMICS.md).

Live: https://arclaw.app (devnet). X: https://x.com/arclawapp

## Stack

| | |
|---|---|
| Web | Next 16 (App Router), React 19, Tailwind v4, GSAP and Lenis, Vercel (with Web Analytics) |
| Wallets | Solana wallet adapter (every Wallet Standard wallet) and Mobile Wallet Adapter on Android |
| Program | Anchor 1.2, in `solana/` |
| Real time | MagicBlock ephemeral rollups: each claw round is delegated, moves are gasless, then committed back |
| Randomness | MagicBlock VRF, on the rollup |
| Money | Circle USDC (devnet USDC from faucet.circle.com) |
| Stocks | xStocks (Token-2022) on mainnet, test mints on devnet |
| Backend | Convex (leaderboard indexer), Telegram bot (`app/api/telegram`) |

## Layout

```
app/              routes: landing (/), the app (/app/*), claim, pull share pages, whitepaper and legal, api
components/       landing, app, claw machine, motion, wallet, pack, seo
lib/solana/       network config, program client (instructions, accounts, events), rounds, reads
lib/              machines and odds, share signing, og images, prices
convex/           schema and the leaderboard indexer
solana/           the Anchor program, its IDL
scripts/          solana (devnet setup), dev (screenshots, profiling), assets (logos, cabinet art), ops (telegram)
public/           logos, cabinet art (generated), video, sfx
brand/            logo sources and the launch video source
docs/             architecture, tokenomics, security, deployment
proxy.ts          region gate (451 for restricted countries on /app and /claim)
```

## Run it

```sh
pnpm install
cp .env.example .env.local      # fill in what you need; nothing is required to browse the site
pnpm dev                        # http://localhost:3000
pnpm typecheck && pnpm lint && pnpm build
```

Program and client:

```sh
cd solana && cargo test --lib  # table rules and the draw
anchor build                    # the SBF binary (Solana toolchain + anchor-cli 1.2.2)
pnpm test                       # the TypeScript client against solana/idl/arclaw.json
pnpm solana:setup               # devnet: stocks, vault, machines and tables (solana/README.md)
```

Generated assets: `pnpm cabinet` rewrites `public/cabinet/*.svg` after the cabinet art or `claw.css` changes (needs a local
Chromium through playwright-core). `pnpm shots` takes screenshots for design review (see `scripts/dev`).

## Environment

See [`.env.example`](.env.example). The ones that matter:

| Variable | Where | What |
|---|---|---|
| `NEXT_PUBLIC_SOLANA_NETWORK` | Vercel | `devnet` (default) or `mainnet` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Vercel | Solana RPC; use a private one in production |
| `NEXT_PUBLIC_MAGICBLOCK_RPC_URL`, `NEXT_PUBLIC_MAGICBLOCK_VALIDATOR` | Vercel | the rollup region (optional, must match) |
| `NEXT_PUBLIC_CONVEX_URL` | Vercel | the Convex deployment for the leaderboard |
| `APP_ORIGIN` | Vercel | public origin for metadata and share cards |
| `SHARE_SECRET` | Vercel | signs shared-pull links (`openssl rand -hex 32`), server only |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Vercel | the bot |
| `BLOCKED_COUNTRIES` | Vercel | optional, replaces the default region list in `proxy.ts` |

## Docs

- [`docs/SOLANA.md`](docs/SOLANA.md): how a round runs across Solana and MagicBlock, the program rules, the trust model.
- [`docs/TOKENOMICS.md`](docs/TOKENOMICS.md): machines, odds, treasury rules.
- [`docs/SECURITY.md`](docs/SECURITY.md): roles, what to review, what is still open.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) and [`solana/README.md`](solana/README.md): devnet deploy, Vercel, Convex.
- The whitepaper is a page of the site: `/whitepaper` (`app/(legal)/whitepaper`).

## Conventions

Commits are `type: subject`, no body. The design rules (no em dashes, one accent colour per screen, no gradients or glow)
are in [`DESIGN.md`](DESIGN.md) and [`CLAUDE.md`](CLAUDE.md). Every program change gets two independent reviews and green
tests before any deploy.
