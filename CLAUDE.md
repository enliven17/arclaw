# arclaw

Pay USDC on Arc, play a 3D claw machine, win a sealed box. Box opens into a pack of 3 cards, every card is a real tokenized stock (Astock `.arc` ERC-20s).

## Product rules (decided 2026-10-17)

- Every play wins a box. The claw is theatre; the contract decides the contents. There is no "miss".
- Three machines: 1, 5 and 10 USDC per play. 1 play = 1 box = 1 pack = 3 cards. Each card pays a stock amount (e.g. 0.10 USDC of NVDA).
- Economics (updated 2026-10-17): a box's outcome is drawn from its machine's weighted outcome table. Every outcome is a full pack (3 cards). On-chain rules per machine:
  - floor: every outcome is worth at least 50% of the play price (nobody leaves with less than half back),
  - cap: no outcome is worth more than `capBps` of price (default 10x, configurable per machine),
  - expected return (RTP) within a band, default 75 to 85%, so the house edge is 15 to 25%,
  - weights are steeply unequal: small outcomes common, big ones rare.
- Single source of truth for the tables: `lib/machines.json` (read by the deploy script and the site's odds section).
- Prizes are paid from pre-bought `.arc` inventory held by the contract. Operator refills via the Astock desk (`buy(stock,minOut,to)`). Pool short for a card: refund that card's value in USDC.
- Randomness: D20DAO VRF behind a small interface so it can be swapped.
- Boxes are giftable: to an address, or via claim link (ephemeral key signs the recipient, no front-running).
- Wallets: Circle passkey smart wallet (mimir `lib/arc/*`) AND injected wallets via wagmi.
- Landing (`/`) is marketing only: nothing is played there; every Play CTA links into the app.
- The app lives under `/app`: play, the user's collection (every card pulled, current holdings and live value), and selling stocks back to USDC (Astock desk `sell(stock, sharesIn, minUsdcOut, to)` after approve; testnet uses the mock desk).
- App flow (user spec 2026-10-17): `/app/play` is a marketplace with the three machines side by side. Tap a machine to enter it. Inside, a control panel handles the transactions (connect, choose boxes, pay, open). The machine runs its claw sequence and drops the box. The box goes full screen; tap to open it and a pack comes out; tap the pack to tear it; each tap deals one face-down card (3 total); once all three are out, tap any card to flip it.
- Security: every contract change gets two independent audits plus green tests before any deploy.

## Chain facts

| | Mainnet | Testnet |
|---|---|---|
| chainId | 5042 | 5042002 |
| RPC | https://rpc.mainnet.arc.io | https://rpc.testnet.arc.io |
| Explorer | https://explorer.arc.io | https://explorer.testnet.arc.io |
| USDC ERC-20 (6 dec) | 0x3600000000000000000000000000000000000000 | same |
| D20 VRF coordinator | 0xd20da057469C45928912d983F45790C41e290571 | 0xd20DA0FF9087d053f0291524Eac12abA1ADBd945 |

- Native gas is USDC with **18 decimals** (`msg.value`); the ERC-20 view has 6. Never mix them.
- `PREVRANDAO` is always 0. Value to `address(0)` reverts. `maxFeePerGas` under 20 gwei is dropped.
- Astock exists on **mainnet only**. Testnet uses mock `.arc` tokens + mock price source.
- Astock v2 addresses: desk `0x3ac68fc2ad55599fa528fefa1f05cc1c1df26d69`, oracle `0x77905f095fa62fc472e56f17bdc039dc764c1595` (`getPrice(underlying)` USD 6 dec). Token list: `pandock/web/src/config.ts`. Ignore `/api/deployment` (stale v1).

## Stack

Next 16 + React 19 + Tailwind v4 (`@theme` in `app/globals.css`), Convex, Vercel. Foundry in `contracts/`. Base patterns copied from `../snipadfun` (providers, SmoothScroll, `lib/og`), motion engine ideas from `../mimir-solana/lib/motion.ts`.

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
