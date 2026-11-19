# Deploy

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
