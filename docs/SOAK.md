# Solana devnet soak

The harness reuses the 200 keypairs from Kondora's `scripts/soak-devnet.mts` input,
`../kondora/.keys/faucet/wallets.json`. It reads that file in place; it does not create,
copy, overwrite, or commit wallet keys. Kondora positions and trading deposits are untouched.
Do not run another test against the same wallets concurrently.

`.env.local` must contain the devnet RPC configuration and `SOLANA_KEYPAIR` pointing
to the existing program admin keypair. The RPC genesis hash, Circle devnet USDC mint,
program deployment and admin identity are checked before transactions.

```powershell
pnpm solana:soak --audit
pnpm solana:soak --limit 200 --concurrency 8 --passes 1 --run kondora-200
```

Each wallet buys a Single box (1 USDC), delegates a round, makes randomized claw
moves on MagicBlock, requests VRF, commits back to Solana, settles all three actual
stock transfers, and converts its test stock holdings to USDC. Success requires a
real paid settlement, a closed round, and no remaining test stock holdings.
Voided rounds return their sealed box and count separately; they never count as a pass.
Infrastructure errors are retried up to four times with the same on-chain round.

**The stock conversion is a devnet operator buyback, not a market swap.** The nine
project test mints have no exchange market. The harness quotes their actual token
balances at the repository's fixed stock-price snapshot, rounds down to whole
micro-USDC, and atomically transfers the stocks into the prize vault in exchange
for existing Circle devnet USDC. The same transaction closes the emptied stock
accounts and returns their SOL rent to the wallet. No USDC is minted.
The program's existing admin `withdraw` instruction protects unsettled-box and
owed-refund reserves. If free treasury liquidity is insufficient, the harness
first rotates existing test USDC into the treasury.

USDC is rotated between input wallets as needed; donors keep at least 0.01 USDC.
After every wallet finishes and all rounds close, free devnet treasury USDC
is distributed equally to the input wallets so the funds can be reused in other
projects. The program protects all sealed-box and owed-refund reserves.
`--recycle-only` performs this final distribution without playing again.
The admin sponsors transaction fees and tops wallets below 0.025 SOL up to 0.04
devnet SOL. Individual wallet balances change with wins, funding rotations and the
final distribution; they are not guaranteed to equal their starting balances.
Other mints, Kondora deposits and open positions are untouched. The final report
also verifies that total Circle USDC across the input wallets, admin and treasury
equals the initial total; all stock buybacks and funding transfers conserve it.

All run state stays under the ignored and deployment-excluded directory
`.cache/solana-soak/<run>/`:

- `events.jsonl`: transaction signatures, retries, successful rounds and buybacks.
- `summary.json`: counts, unresolved rounds, remaining stocks, before/after balances.
- `state.json`: resumable progress and signed buyback transaction receipts.
- `sessions.json`: private ephemeral round keys. Retain this file until recovery finishes.
- `lock.json`: prevents two processes using the same run checkpoint.

Run the same command again to resume; completed wallets are not replayed. For a
fresh test, use a different `--run`. `--passes` controls rounds per wallet;
`--machines 1,2,3` rotates machines, but needs substantially more USDC than the
default 1-USDC scenario. `--limit` restricts the input wallets used, including donors.

```powershell
# Recover existing rounds and buy back holdings without buying new boxes:
pnpm solana:soak --cleanup-only --run kondora-200
# Verify balances without sending transactions:
pnpm solana:soak --audit --run kondora-200
pnpm test:soak
```

Keep the original limit, passes and machine selection when resuming or cleaning up.
Ctrl+C requests a graceful stop: active rounds finish and stock cleanup runs.
If the process is killed, rerun it to recover from the persisted session keys.
Buyback signatures are saved before broadcast; an uncertain payment is never
blindly issued again. Inspect the recorded signature if RPC history cannot resolve it.
An incomplete run or leftover round/stock exits nonzero and appears in the summary.
