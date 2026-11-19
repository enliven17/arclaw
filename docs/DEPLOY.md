# Deploy

## Active devnet (2026-11-19)

The `magicblock` branch runs on Solana devnet. Program and mint addresses are recorded in
[`lib/deployments/solana-devnet.json`](../lib/deployments/solana-devnet.json); the matching packs are in
[`lib/machines.resolved.json`](../lib/machines.resolved.json).

| Component | Deployment |
|---|---|
| Solana program | `DJMcHeBR4sSN2e7kx56fennhEdQpbAV7nmxLTAYS7WeW` |
| Config / stock vault authority | `HaXkdpWDbz8oSiCTaSKTzB1TVEVgNWThCY5TUudi8Jos` |
| MagicBlock rollup | `https://devnet-as.magicblock.app`, default Asia validator |
| USDC | Circle devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Convex project | `kiro2:arclaw-solana` (new account, no imported data) |
| Convex production | `https://blissful-frog-587.eu-west-1.convex.cloud` |
| Convex development | `https://perceptive-turtle-543.eu-west-1.convex.cloud` |
| Web | `https://arclaw.app` |

All three machines have active six-outcome tables. Snapshot RTP: Single 75.01%, Stack 80.01%, Vault 85.01%.
Each of the nine test stock vaults was funded with 100,000 test shares. Devnet tokens have no monetary value.

Validated on devnet: pay Circle USDC, start and delegate a round, move the claw, receive MagicBlock VRF, commit and
undelegate, settle all three stock cards, and close the round. A timed-out round was also voided and its box returned.
Successful settlement:
[`GqbaYxAy...N25f8G`](https://explorer.solana.com/tx/GqbaYxAyG3u4hy6v6HAYbv2cEJcMNDA74GJ1KjDXGYybcesJCwShK4piLjscWSQ1T7wDwhLEuMq4Npe9nN25f8G?cluster=devnet).
The new Convex indexer records the same 0.8 USDC test pack. History reads accept Solana transaction versions through v1.

Copy `.env.example` to `.env.local`, set `SOLANA_KEYPAIR` and `NEXT_PUBLIC_SOLANA_RPC_URL`, then use
`pnpm solana:setup` or `pnpm solana:smoke`. Both scripts load `.env.local`. The smoke test spends 1 devnet USDC if no
Single box is already held, and a little devnet SOL. Program / buffer keypairs stay outside the repository.

Vercel production uses the production Convex URL and `NEXT_PUBLIC_SOLANA_NETWORK=devnet`. Both Convex deployments and
Vercel use a configured Helius devnet RPC; its API key is kept in environment variables. The obsolete Arc, Privy and
WalletConnect production settings have been removed. `.vercelignore` excludes private env files, program builds,
keypairs and the legacy contracts while retaining `lib/brand` and `public/brand`.

## Program (devnet)

The full runbook is in [`solana/README.md`](../solana/README.md): `anchor keys sync`, `anchor build`,
`anchor deploy --provider.cluster devnet`, then `pnpm solana:setup` from the repo root (test stock mints, vault
inventory, `initialize` with Circle's devnet USDC, the three machines and their tables from `lib/machines.json`).
The setup script writes `lib/deployments/solana-devnet.json` and `lib/machines.resolved.json`; commit both.

## Mainnet

Not yet: the program needs two independent audits first (`docs/SECURITY.md`). When it goes: admin key in a Squads
multisig, stocks are xStocks (Token-2022) bought on Jupiter into the vault, USDC is Circle's mainnet mint, and the
deployment JSON goes in `lib/deployments/solana-mainnet.json` or `NEXT_PUBLIC_SOLANA_MAINNET_DEPLOYMENT`.

## Web (Vercel)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SOLANA_NETWORK` | `devnet` (default) or `mainnet` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | a private RPC (Helius, Triton...) in production |
| `NEXT_PUBLIC_MAGICBLOCK_RPC_URL`, `NEXT_PUBLIC_MAGICBLOCK_VALIDATOR` | only to pick another rollup region (they must match) |
| `NEXT_PUBLIC_CONVEX_URL`, `APP_ORIGIN`, `SHARE_SECRET`, Telegram | as before (`.env.example`) |

## Convex

`npx convex deploy`. The only cron is `indexer:sync` (every minute): it reads the program's transactions after its
cursor and fills the leaderboard tables. It needs `NEXT_PUBLIC_SOLANA_NETWORK` (and a private RPC in
`NEXT_PUBLIC_SOLANA_RPC_URL`) in the Convex env.
