# Devnet validation — 2026-11-19

Validated branch `magicblock` against the deployed Solana program
`DJMcHeBR4sSN2e7kx56fennhEdQpbAV7nmxLTAYS7WeW`, using the existing Kondora
wallet file in place. No input keypairs were replaced or copied.

| Check | Result |
| --- | --- |
| Existing wallets exercised | 200 / 200 |
| Machine | Single, 1 Circle devnet USDC |
| Confirmed rounds | 200 |
| Paid stock cards | 600 |
| Infrastructure retries / failed wallets | 0 / 0 |
| Stock buyback transactions | 200 |
| Final USDC distribution transactions | 25, eight recipients each |
| Pending rounds / sealed boxes | 0 / 0 |
| Remaining test stocks / owed refunds | 0 / 0 |
| Final wallet USDC total | 98.599802 |
| Lowest individual wallet USDC | 0.308098 |
| Admin USDC / treasury dust | 0.5 / 0.000198 |
| Total tracked USDC before and after | 99.1 / 99.1 |

Each round exercised real base-chain payment, delegation, randomized claw movement
on MagicBlock, a VRF callback, commit/undelegation, and three paid stock transfers
on Solana. The first round started at 18:55 UTC; the final round settled at 19:12 UTC.
USDC distribution and independent account verification finished at 19:14 UTC.
A separate four-wallet pilot passed before the batch.

Test stocks were converted through the documented **devnet operator buyback** at
the fixed price snapshot; these test mints have no exchange market. Stock transfers,
USDC payments and empty stock account closures were atomic. Free treasury USDC was
then returned to the same 200 wallets. The genesis hash and Circle devnet USDC mint
were checked before sending transactions.

Independent batched account reads confirmed all latest round accounts were closed,
all player sealed-box balances and owed refunds were zero, and both global reserves
were zero. Total USDC across the 200 wallets, admin and treasury remained exactly
99,100,000 micro-USDC. Production Convex leaderboard ingestion was also observed
during the run.

Example confirmations:

- [Final paid settlement](https://explorer.solana.com/tx/EfKMGCgTcsepm5VzREBUc4Xcv3Ag1BYimBLQ2qbCaXjH5DzUNebxrrHEAPEkxhDp28yMNvAdnPsqq5JiMN1Ntuo?cluster=devnet)
- [Final stock buyback](https://explorer.solana.com/tx/3RV3VjXvYQPKSi8oCRChUCydTcyaszJL1E9kkZyyQNNRvc4LAg9DctkEFj4UwHfZ29ntySZ1cXFQicZNvbqsLB3T?cluster=devnet)
- [Final eight-wallet USDC distribution](https://explorer.solana.com/tx/56AaSd8dQmp1aziW2xEFtUmeMzFzuNHhFjgJB8njdy3DXWBgRcN5Dd6oARvG8yB5ZF2jNyQSgJjm2phm7L5AfZ8s?cluster=devnet)

Detailed local results are in `.cache/solana-soak/kondora-200/summary.json`,
`verification.json` and `events.jsonl`. Session files and signed transaction
checkpoints stay ignored and excluded from deployments.

This validates the devnet Single-machine path. The 5/10 USDC machines, mainnet
assets, exchange swaps and browser wallet prompts were not covered by this batch.
See [SOAK.md](SOAK.md) for commands, recovery and another run.
