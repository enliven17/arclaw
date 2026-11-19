# arclaw

Pay Circle USDC on Solana, steer a claw live on a MagicBlock ephemeral rollup, win a sealed box. Box opens into a pack of 3 cards, every card is a real tokenized stock (xStocks on mainnet, test mints on devnet). Built for the Solana x MagicBlock "claw machine" idea. Moved from Arc to Solana on 2026-11-19 (branch `magicblock`); the Arc contracts live in git history.

## Product rules (decided 2026-10-17)

- Every play wins a box. The claw is theatre; the program decides the contents (MagicBlock VRF + the weighted table). There is no "miss".
- Three machines: 1, 5 and 10 USDC per play. 1 play = 1 box = 1 pack = 3 cards. Each card pays a stock amount (e.g. 0.10 USDC of NVDA).
- Economics (updated 2026-10-17): a box's outcome is drawn from its machine's weighted outcome table. Every outcome is a full pack (3 cards). On-chain rules per machine:
  - floor: every outcome is worth at least 50% of the play price (nobody leaves with less than half back),
  - cap: no outcome is worth more than `capBps` of price (default 10x, configurable per machine),
  - expected return (RTP) within a band, default 75 to 85%, so the house edge is 15 to 25%,
  - weights are steeply unequal: small outcomes common, big ones rare.
- Single source of truth for the tables: `lib/machines.json` (read by the deploy script and the site's odds section).
- Prizes are paid from pre-filled stock inventory held by the program's vault (config PDA token accounts). Operator refills it (mainnet: buy xStocks on Jupiter). Vault short for a card: refund that card's table value in USDC, or record it as owed.
- Randomness: MagicBlock VRF (`drop_claw` requests on the rollup queue, `reveal_round` is the callback).
- Real time: each round is a Round PDA delegated to a MagicBlock ephemeral rollup. Claw moves are rollup transactions signed by a session key the browser holds (no prompt, no fee). Two wallet signatures per round: start (+delegate) and settle.
- Boxes are giftable: to an address, or via claim link (the link key co-signs the recipient's claim transaction, no front-running).
- Wallets: Solana wallet adapter (Wallet Standard wallets) AND Mobile Wallet Adapter, so it plays from a phone.
- Landing (`/`) is marketing only: nothing is played there; every Play CTA links into the app.
- The app lives under `/app`: play, the user's collection (every card pulled, current holdings and live value), and selling stocks back to USDC (mainnet: a Jupiter swap; devnet test stocks have no market).
- App flow (user spec 2026-10-17): `/app/play` is a marketplace with the three machines side by side. Tap a machine to enter it. Inside, a control panel handles the transactions (connect, choose boxes, pay, grab). Grab starts a round: the player steers the claw with a joystick on the rollup, drops it, the machine runs its claw sequence and drops the box. The box goes full screen; tap to open it and a pack comes out; tap the pack to tear it; each tap deals one face-down card (3 total); once all three are out, tap any card to flip it.
- Security: every program change gets two independent audits plus green tests before any mainnet deploy. The Solana program is not audited yet.
- Treasury: box revenue funds payouts; the price of every unsettled box and every owed refund is reserved. No just in time buys on Solana (see docs/SOLANA.md).
- ARCLAW token luck boost: not ported to Solana.
- Leaderboard in the app, fed by a Convex indexer of the program's events (`Played`, `RoundSettled`).
- Telegram bot with designed message images; on first /start it plays the launch video.
- Launch video built with `../ft-motion`: a big claw comes down in the middle, pulls a box up from below the frame, the box opens. Sound effects throughout, and in the site/app.
- X: https://x.com/arclawapp. Legal pages: `/disclaimer`, `/privacy`.

## Chain facts

| | Mainnet | Devnet |
|---|---|---|
| Solana RPC | https://api.mainnet-beta.solana.com (use a private one) | https://api.devnet.solana.com |
| USDC (Circle, 6 dec) | EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v | 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (faucet.circle.com) |
| MagicBlock rollup | https://as.magicblock.app | https://devnet-as.magicblock.app (validator MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57) |
| Explorer | https://explorer.solana.com | same, `?cluster=devnet` |

- Program ids: delegation `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`, magic `Magic11111111111111111111111111111111111111`, VRF `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz` (queues in `solana/README.md`).
- Use real Circle USDC on devnet, never a mock USDC (user decision 2026-11-19). Stocks are test mints on devnet.
- Fees are SOL. Program amounts are USDC 6 dp (`u64`). xStocks are Token-2022; the program accepts both token programs.
- The app builds instructions by hand (`lib/solana/program.ts`); after changing the program, regenerate `solana/idl/arclaw.json` and run `pnpm test`.
- A Solana transaction is at most 1232 bytes: a table of 6 outcomes fits one `set_table`, 12 would not.

## Stack

Next 16 + React 19 + Tailwind v4 (`@theme` in `app/globals.css`), Convex, Vercel. Anchor 1.2 + MagicBlock SDK 0.20 in `solana/`; `@solana/web3.js` 1.x + wallet adapter in the app. Base patterns copied from `../snipadfun` (providers, SmoothScroll, `lib/og`), motion engine ideas from `../mimir-solana/lib/motion.ts`.

## Design rules (hard)

- No em dashes in any user-visible text. No dot separators in copy.
- No blinking or pulsing dots, no "live" dots, no infinite frame-rate animations.
- No accent lines, no decorative top/side bars, no gradients, no glow. Hairline borders at low opacity only.
- One accent colour per screen. Headings never bold. Money in mono with tabular numbers.
- Lenis + GSAP ScrollTrigger, one Lenis on the GSAP ticker. Reduced motion: no Lenis, no split text, no marquee.
- Brand guide lives in `brand/README.md`. See `DESIGN.md` for tokens.

## Commits

`type: subject`, no body.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
