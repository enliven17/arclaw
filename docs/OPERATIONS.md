# arclaw operations runbook

How the house keeps the machines running: the keeper bot, its key, what each alert means and what to do about it.
Treasury rules and odds live in `docs/TOKENOMICS.md`; this file is about running them.

## What the keeper does

Without a keeper, fulfilled openings wait for their opener, expired VRF requests sit until someone retries, tables
go stale and nobody watches the float. The keeper (`lib/keeper`, plain TypeScript on viem) does all of it, and spends
only when someone can use what it pays for.

| Job | When | Code |
|---|---|---|
| Reveal fulfilled openings | every 30 s (Convex) or every 5 s (`keeper watch`) | `lib/keeper/ops.ts` reveal |
| Serve wake requests | every 30 s: a machine a visitor woke is repriced at once if it is due | `lib/keeper/tick.ts` |
| Retry expired VRF requests | every five minutes in Convex, once per opening (Arclaw allows one), logged with openingRetries | `lib/keeper/ops.ts` retryOrReturn |
| Probe a failing VRF | `pauseIfVrfDown` only when opens keep failing, at most every 10 minutes | `lib/keeper/ops.ts` probeVrf |
| Reprice tables | every five minutes it checks the policy below | `lib/keeper/reprice.ts`, `lib/keeper/demand.ts` |
| Health and alerts | every five minutes | `lib/keeper/health.ts`, `lib/keeper/alert.ts` |

It runs two ways, same code:

- **Convex crons** (production): `convex/keeperRun.ts` (`"use node"` actions `heartbeat`, `reveal`, `tick`, `reprice`), scheduled
  in `convex/crons.ts`; storage in `convex/keeperState.ts`; the public `keeper:wake` and the admin-only `keeper:status` in
  `convex/keeper.ts` (a `"use node"` file can only hold actions). The actions do nothing until `KEEPER_PRIVATE_KEY` is
  set in the Convex env. Manual reprice: `npx convex run keeperRun:reprice '{"force":true}'`.
- **CLI** (operator laptop, a backup VM, tests): `pnpm keeper <command>`.

```
pnpm keeper tick                    one full pass: reveal, retry, probe, reprice if due, health, alerts
pnpm keeper tick --reveal-only      reveals and wake requests only (what the 30 s heartbeat runs)
pnpm keeper reprice                 reprice the machines that are due under the policy
pnpm keeper reprice --force         reprice every machine now: ignores demand and the daily cap, still fails closed on bad prices
pnpm keeper reprice --force --machine 3
pnpm keeper wake --machine 3        record a wake request (what keeper:wake does)
pnpm keeper status                  per machine: fresh, openable, waking, demand (what keeper:status returns)
pnpm keeper health                  read-only report; exit code 2 when anything is critical
pnpm keeper state                   tables, moves, oracle prices, open openings
pnpm keeper watch                   loop: reveal and wakes every 5 s, full tick every minute
  --dry-run                         simulate every call, sign nothing, persist nothing
  --network testnet|mainnet  --rpc URL  --deployment file.json  --market auto|open|closed  --price-check off|astock|URL  --json
```

The CLI reads the environment, then `.env.keeper` and `.env.local` if present (never overriding what is set). Its
state is in `.cache/keeper/` (gitignored). Running the CLI and Convex against the same contract at the same time is
safe for the chain (every call is simulated first, so a double reveal costs nothing) but they keep separate locks,
caps and backoff, so pick one as primary.

## Keys and roles

| Role | Who | Can | Cannot |
|---|---|---|---|
| owner | multisig | rules, unpause, withdraw free balance, sweep, roles | lower floor or rtpMin, touch reserves |
| guardian | separate hot key (`setGuardian`) | `pause()` only | unpause, anything with money |
| operator | keeper hot key | `operatorSetPrizes` (only tables inside the machine's floor, cap and RTP band), `spend` (buy stock into the contract, allow-listed desk, `dailyCap` per UTC day) | withdraw, sweep, pause, change rules |
| keeper | same hot key (`setKeeper`) | reveal any opening at once, `rescue` after 7 days, `retry` once per opening on the house VRF subsidy | anything with money |
| anyone | | `pauseIfVrfDown()` (reverts `VrfAlive` on a working VRF) | |

The keeper key is a hot key. It holds gas only (keep 2 to 5 USDC on it; health warns under `KEEPER_MIN_GAS_USDC`,
default 1) and must hold no other role: health warns (`guardian-is-keeper`) if it is also the guardian. If it leaks,
the worst case is repricing inside the on-chain rules (the RTP band holds whatever it sets) and spending up to
`dailyCap` a day on stock that lands in the contract. It cannot move money out. Rotate it (below).

The key is read in one place (`lib/keeper/tx.ts`), never logged, never returned from an action, never stored.

`Deploy.s.sol` makes `KEEPER` (default `OPERATOR`) a keeper and `GUARDIAN` (default `OWNER`) the guardian. For the bot,
keeper and operator must be the same address. Health raises `not-operator` or `not-keeper` if they are not.

## Environment

| Name | Where | Meaning |
|---|---|---|
| `KEEPER_PRIVATE_KEY` | Convex env, `.env.keeper` | the hot key (32-byte hex) |
| `KEEPER_ADDRESS` | CLI | dry runs without a key |
| `KEEPER_NETWORK` | both | `testnet` or `mainnet` (default `NEXT_PUBLIC_ARC_NETWORK`, else testnet) |
| `KEEPER_RPC_URL` | both | comma list of RPCs, tried in order; use a private RPC on mainnet |
| `KEEPER_DEPLOYMENT_JSON` | both | the deployment JSON inline; only needed while `lib/deployments/arc-mainnet.json` is empty |
| `KEEPER_PRICE_CHECK` | both | second price source: `astock` (mainnet default), `off` (testnet default), or a URL with the same JSON shape |
| `KEEPER_MAX_REPRICES_PER_DAY` | both | reprices per machine per UTC day before the keeper stops and alerts (default 6) |
| `KEEPER_DRY_RUN` | both | `1` signs nothing |
| `KEEPER_MIN_GAS_USDC` | both | gas balance warning (default 1, critical under a fifth) |
| `KEEPER_MAX_VRF_TOPUP_USDC` | both | most the keeper adds above `maxVrfSubsidy` on a retry (default 0.1) |
| `ALERT_TELEGRAM_CHAT_ID` | both | where alerts go |
| `TELEGRAM_BOT_TOKEN` | both | the existing bot token; the bot must be a member of the alert chat |

Convex: `npx convex env set KEEPER_PRIVATE_KEY 0x...` (and the others). The crons pick it up on the next run.

## Reprice policy

A reprice of all three machines costs about 0.2 USDC. Repricing every hour whatever happens would cost about 5 USDC a
day with nobody playing, so the keeper only pays for tables someone can use (`repriceReason` in
`lib/keeper/reprice.ts`, demand in `lib/keeper/demand.ts`):

1. **Switched on only.** A machine with `machineOff(id)` is never repriced (mainnet launches with Single only). Nothing
   is repriced while the contract is paused or while the VRF miss breaker has closed opens (`VrfMisses` until 00:00
   UTC): no table is worth paying for when nobody can open.
2. **Demand only.** A machine has demand when any of these holds:
   - sealed boxes of it are outstanding (`boxesSold` minus opened, plus returned, minus refunded, from the logs),
   - an opening of it is pending or fulfilled and not yet revealed,
   - it was played in the last 24 hours,
   - a visitor woke it in the last 60 minutes (`keeper:wake`).
3. **With demand, only when needed:**

   | Reason | Rule |
   |---|---|
   | no-table | the machine has no table |
   | moved | any card token moved 2% or more from the table's reference price (opens refuse past 5% and the floor tier is only 5.3% above the floor), at any hour the oracle answers |
   | stale | the table is past `maxTableAge` (24 h): opens are refused now |
   | aged | the table is 18 hours old (before the 24 h expiry; 3/4 of `maxTableAge` if that is shorter) |

4. **No demand: nothing is spent.** The table is allowed to go stale. Health shows it as info, not an alert.
5. **Daily cap.** At most `KEEPER_MAX_REPRICES_PER_DAY` (6) reprices per machine per UTC day. Past it the machine is
   skipped until 00:00 UTC and `reprice-cap:N` is raised. A forced reprice ignores demand and the cap but counts.

A 60 s minimum between reprices of one machine applies to every reason except a move. Health reports the keeper's
gas spend per UTC day (`gasSpentTodayUsdc`) and reprices per machine today (`mNRepricesToday`).

Before signing, every reprice must pass, or it is skipped and alerted (fail closed):

1. The on-chain oracle (`priceSource.priceOf`) answers for all 8 tokens.
2. The second source agrees within 1% on every token, is not older than 15 minutes, has no halted symbol.
3. The keeper is the operator.
4. `lib/machines.json` matches the machine's on-chain rules (price, floor, cap, RTP band).
5. The table built by `buildTable` (an exact port of `Deploy.s.sol`, tested against the Solidity output) passes the
   same floor, cap and RTP checks `setPrizes` runs, at the oracle prices.
6. `eth_call` of `operatorSetPrizes` succeeds.

On mainnet the second source is Astock's public feed (`astock.fi/api/prices`, `mid` per symbol). It is a different
path from the on-chain oracle but the same provider; for a truly independent check point `KEEPER_PRICE_CHECK` at any
URL answering `{ "quotes": [ { "symbol", "mid", "halted", "generatedAt" } ] }`.

## Wake and the status page

A machine nobody used for a day sleeps with a stale table. When a visitor opens its page:

1. The app reads the machine's table straight from the chain (`lib/arclaw/status.ts`). `keeper:status` holds the
   same per machine view (`fresh`, `openable`, `waking`, `staleAt`, `demand`, `readAt`) plus health and the event
   log, and takes `ADMIN_QUERY_SECRET` (Convex and Vercel env): only `/api/admin` reads it.
2. If it is not fresh, the app calls `keeper:wake({ machineId })` (public mutation; only ids from `lib/machines.json`;
   one per machine per 60 s, a repeat answers `{ accepted: false }`) and shows "getting the machine ready".
3. The 30 s heartbeat sees the new wake, reprices the machine if it is due (stale, aged or moved) and saves its new state;
   `keeper:status` then reports it fresh, typically within a minute after the first visitor.
4. The wake keeps counting as demand for 60 minutes, so the machine stays fresh while people are looking at it.

A wake on a fresh machine costs nothing (no reprice is due). A wake on a switched-off machine, while the contract is
paused, or while the miss breaker has closed opens, does nothing; `keeper:status` then reports `openable: false`
and `opensClosedUntil` (the next 00:00 UTC). Convex caches queries, so `fresh` is as of the keeper's last state write (every 30 s or five minutes);
`staleAt` lets the UI judge between writes.

## Weekends and market closed

The market clock (`lib/keeper/market.ts`) is NYSE regular hours, 09:30 to 16:00 New York, weekdays, minus the full-day
holidays listed in `NYSE_HOLIDAYS` (2026 and 2027; **add each new year** before January). It only sets alert severity
now (critical while the market is open, warn otherwise); the reprice policy does not depend on it.

- Astock's oracle reverts `Stale` when its feed is old (weekends, holidays). Then `open` reverts in the contract for
  every machine and the keeper skips reprices: an `oracle` issue, info unless a machine with demand is stale or moved.
- With nobody playing over a weekend, tables just go stale and nothing is spent. Sealed boxes become refundable at
  `sealedRefundAt(id)` (3 days after the table went stale, the machine was switched off or the contract paused), so
  with sealed boxes outstanding the first good reprice after the weekend matters: sealed boxes are demand, so the
  keeper does it as soon as the oracle answers.
- Reveals and retries do not depend on the market. A retry needs its pinned table to still be openable (fresh and
  within 5%); when the table aged out the opener takes the boxes back with `returnBoxes`.

## Float sizing

`reserveFloor` is native USDC that `withdraw` and `spend` never touch but just-in-time buys at reveal may use: it pays
the part of an Epic or better pack the box price does not cover. Just-in-time buys are also capped per UTC day
(`limits().jitCap`, default 2000 USDC); health warns at 80% (`jit-cap`).

`pnpm keeper:simulate` estimates the risk (Monte Carlo over `lib/machines.json`, desk spread and VRF fee included):

| Machines on | Float | Float runs dry within 30 days (5 or 50 boxes a day) |
|---|---|---|
| Single only (launch) | 5 USDC (deploy default) | about 3.5% |
| Single only | 10 USDC | about 0.5% |
| Single only | 25 USDC | 0% |
| Single, Stack, Vault (60/30/10) | 100 USDC | about 0.15% |
| Single, Stack, Vault | 250 USDC and up | 0% |

**Recommended: 25 USDC at a Single-only launch** (the 5 USDC default dries up in about 1 run in 30), 500 USDC once
Stack and Vault are on. The risk is front-loaded, before the house has earned anything. Set it with the owner's
`setJit(desk, 100, 60, 60e18, floor)` and keep the unreserved balance above it by sending native USDC to the contract
(`receive()` accepts top-ups). Health warns (`float-jackpot`) while the unreserved balance cannot pay one top pack of
a switched-on machine (9.9 USDC for Single, 99 for Vault).

If the float runs dry a reveal records an IOU (`totalOwed`) and the contract pauses itself (see `owed`). Only a new IOU
pauses: once you have funded the outstanding IOUs and unpaused, an IOU its holder never claims does not pause again,
so health warns (`owed`) while an IOU is unfunded. Deploys set `minBuffer` to 1 wei: a reveal that leaves nothing
unreserved pauses play.

The float also pays the house VRF subsidy: the subsidy (up to `maxVrfSubsidy`) is only paid while the unreserved
balance covers it. Without a float players pay the whole VRF fee to open and the keeper pays it on retries
(`vrf-subsidy` warns).

## Alerts

Telegram messages look like `CRITICAL arclaw keeper mainnet` then `key: message`. Each is sent when it appears, when it
gets worse, again every hour (critical) or 6 hours (warn) while it lasts, and once as `RESOLVED` when it clears.
Info issues are only in the event log and the status page.

| Key | Severity | Meaning | Do |
|---|---|---|---|
| `paused` | critical | Arclaw is paused (owner, guardian, `pauseIfVrfDown`, a new IOU, or a reveal leaving less than `minBuffer`). Message gives when sealed boxes become refundable | find out why (`vrf-down`, `owed`, `buffer`); fix; owner `unpause()` |
| `vrf-misses` | warn at half, critical at max | VRF misses booked today versus `limits().maxMisses` (default 10). A retried opening books one, a return after a retry none. At the max `open()` reverts `VrfMisses` until 00:00 UTC: **opens are closed, the contract is not paused**; plays, reveals, retries and returns go on and the keeper stops repricing | one trip: nothing, opens reopen at 00:00 UTC. Repeated trips day after day or a dead VRF: the guardian pauses (or `pauseIfVrfDown`); dead-VRF runbook |
| `vrf-retry-expired` | critical | an opening's one retry went unanswered too | dead-VRF runbook; the keeper probes `pauseIfVrfDown` |
| `vrf-down` | critical | `pauseIfVrfDown` succeeded: D20 is down and the keeper paused the contract | dead-VRF runbook |
| `vrf-unreadable` | critical | the coordinator's `getRequest` reverts | dead-VRF runbook |
| `owed` | warn unfunded, info funded | IOUs outstanding (`totalOwed`). Unfunded: the balance is under every reserve plus the IOUs. A funded IOU no longer pauses anything, so this is the signal | send native USDC to the contract until it is funded; holders `claimOwed` |
| `buffer` | critical with openings in flight, else warn | unreserved balance under `minBuffer` (1 wei on deploy): a reveal that leaves no more pauses play | send the float |
| `vrf-subsidy` | warn | the unreserved balance cannot fund the VRF subsidy: players pay the whole fee to open, the keeper on retries | send the float |
| `float-low` | warn | unreserved balance under `reserveFloor`: the float is paying big wins | top up to at least `reserveFloor` |
| `float-jackpot` | warn | unreserved balance cannot pay one top pack of a switched-on machine | top up |
| `jit-cap` | warn | just-in-time buys used 80% of today's cap; past it short cards are refunded | owner `setLimits` if the volume is real |
| `gas` | warn, critical | keeper key low on gas | send 2 to 5 USDC to the keeper address |
| `not-keeper`, `not-operator` | critical | the key lost a role (rotation, misconfigured deploy) | owner `setKeeper(addr, true)` / `setOperator(addr)` |
| `guardian-is-keeper` | warn | the pause-only guardian is the keeper hot key | owner `setGuardian(other)` |
| `stale:N` | critical (market open) or warn with demand, info without | machine N's table is past `maxTableAge`: no opens | with demand: see why reprices fail (`oracle`, `price-check`, `rules:N`, `table-invalid:N`, `reprice-cap:N`). Without: nothing, it wakes on the next visitor |
| `overdue:N` | warn | a machine with demand is more than 19 h old and was not refreshed | same as above |
| `frozen:N` | as `stale:N` | a token moved past `maxPriceMoveBps`: opens refused | with demand the next tick reprices it (`moved`) |
| `reprice-cap:N` | warn | machine N hit `KEEPER_MAX_REPRICES_PER_DAY` today; no more automatic reprices until 00:00 UTC | a market moving that fast: check prices; `pnpm keeper reprice --force --machine N` if a table must be fixed now; raise the cap if it is normal |
| `oracle` | critical, warn or info | `priceSource.priceOf` reverts for a token (Stale, Unmapped, Unpriced) | closed market: nothing. Open market: check Astock status; an unmapped token needs `setUnderlyings` |
| `price-check` | critical (market open, urgent), warn | the second source is down, stale, halted, or more than 1% from the oracle; reprice skipped | compare by hand (`pnpm keeper state` vs the feed). If the oracle is right and the feed is wrong, `--price-check off` for one manual `reprice --force` |
| `rules:N` | critical | `lib/machines.json` and the chain disagree on machine N's rules | change the one that is wrong (owner `setMachine`, or the file) |
| `table-invalid:N` | critical | the built table would fail `setPrizes` at current prices | usually extreme prices; check the oracle |
| `reprice-tx:N` | critical, warn | `operatorSetPrizes` reverted or was not mined | read the message; gas and nonce problems clear on the next tick |
| `reveal-lag` | warn | a fulfilled opening has waited more than 60 s since its request | is the keeper running (`lastTick`)? gas? |
| `reveal-stuck:ID` | critical | a reveal keeps reverting (a card token or the desk misbehaves) | investigate the token; the keeper rescues it (USDC at refund value) 7 days after the request |
| `retry-lag` | warn | an expired VRF request waited over 10 minutes for its retry | keeper down or out of gas |
| `vrf-fee` | warn | a retry needs more than `KEEPER_MAX_VRF_TOPUP_USDC` above the subsidy | owner raises `maxVrfSubsidy` (`setVrfConfig`) or raise the env cap |
| `vrf-retry-rate` | warn | more than 20% of opens in the last 9,999 blocks needed a retry | check D20 status; raise `callbackGasLimit` if callbacks fail |
| `await-return` | info | openings whose retry is used or whose pinned table aged out: only the opener can `returnBoxes` | nothing; the app shows them the button |
| `stuck-tx` | warn | a keeper transaction sits in the mempool; sends pause, replaced with a self-transfer at 3x fees after 3 minutes | if it persists, check the RPC and the gas price rule (Arc drops under 20 gwei) |
| `keeper-failing` | critical | three ticks in a row failed (RPC down, bad config) | read `keeperEvents` / the CLI error; fix the RPC or env |
| `read-markets` | warn | tables or prices could not be read this tick | RPC trouble; clears by itself |

## Dead VRF runbook

Symptoms: `vrf-retry-expired`, `vrf-misses`, `vrf-down`, `vrf-unreadable`, openings stuck in Pending.

How the contract and the keeper limit the damage on their own:

- Each opening gets **one** retry (`openingRetries`, `RetryLimit` after). The keeper uses it as soon as the request
  expires. An expired opening books one VRF miss whether it is retried or returned (a return after a retry books
  none); `limits().maxMisses` (10) in a UTC day close `open` (`VrfMisses`) until 00:00 UTC without pausing and run
  the sealed-refund clock (a trip while already paused leaves the pause's clock alone). While opens are closed the
  keeper does not reprice.
- When opens keep failing (a used retry expired again, the coordinator cannot be read, or 2 or more misses today) the
  keeper calls `pauseIfVrfDown()`, at most every 10 minutes. The call is simulated first: on a working VRF it reverts
  `VrfAlive` and nothing is signed or spent; on a dead one it is sent and pauses the contract (`vrf-down`). It never
  runs on a healthy contract.

What you do:

1. Check the D20 coordinator on the explorer and D20DAO's status. A paused or upgraded coordinator usually comes back.
2. One breaker trip needs nothing: opens reopen at 00:00 UTC. If it trips again day after day, or D20 is dead: the
   guardian calls `pause()` (or anyone calls `pauseIfVrfDown()`, which only pauses when D20 really fails).
3. Openings whose retry is used wait for their opener: `returnBoxes` once the pinned table aged out (24 h after it was
   priced), or 7 days after the request if the coordinator's reads revert.
4. When VRF is back (`pauseIfVrfDown` reverts `VrfAlive`, a test open is fulfilled): owner `unpause()`. The pause clock
   (`pausedSince`) keeps running until a full day of service, so a re-pause the same day does not restart the
   sealed-refund countdown.
5. The coordinator is immutable: if D20 is gone for good, stay paused, let holders `refundSealed`, deploy a new Arclaw.

## Pause

- `pause()`: owner or guardian. Stops `play` and `open`. Reveals, retries, returns, claims and `refundSealed` keep
  working, and the keeper keeps revealing. The keeper does not reprice while paused (nothing can open).
- The contract pauses itself: on a new IOU or the unreserved balance under `minBuffer` after a reveal, retry or
  return, and through `pauseIfVrfDown`. `maxMisses` VRF misses in a day close only `open`, until 00:00 UTC.
- `unpause()`: owner only. It no longer clears `pausedSince`: use `paused()` for "is it paused" and
  `sealedRefundAt(id)` for when sealed boxes become refundable.
- Per machine: `setMachineActive(id, false)` (same effect for one machine, its own clock). Switching a machine on
  later: reprice it first (`pnpm keeper reprice --force --machine N`), then `setMachineActive(id, true)`.

## Rotate the keeper key

1. Generate a new key offline; fund the new address with 2 to 5 USDC of gas.
2. Owner (multisig): `setKeeper(new, true)`, `setOperator(new)`. On testnet also `MockPriceSource.setRelayer(new)`.
3. Set the new key where the keeper runs: `npx convex env set KEEPER_PRIVATE_KEY 0x...` (and `.env.keeper` on any VM).
4. `pnpm keeper health` with the new key: no `not-operator`, no `not-keeper`.
5. Owner: `setKeeper(old, false)`. Sweep the old address's leftover gas.
6. If the old key leaked: do steps 2 and 5 first, in one multisig batch, and lower `dailyCap` until done.

## Testing the keeper

- `pnpm keeper:test`: unit tests. `buildTable` against Deploy.s.sol's own output at four price vectors
  (`lib/keeper/__fixtures__/buildTable.sol.json`), the table checks, the market clock, the reprice policy (demand, age,
  moves, cap), demand, status freshness, the second source and alert dedupe.
- `pnpm keeper:fixture`: regenerates that fixture with forge (after changing `machines.json` or `buildTable`).
- `pnpm keeper:e2e`: the whole loop on a local anvil through the CLI, against the committed contracts (`--worktree`
  for uncommitted ones). It deploys with `MOCK_PRICES=1 forge script Deploy.s.sol` in a temp copy (the repo's
  `lib/deployments` is never touched), then plays, opens, fulfils, reveals, lets requests expire (one retry, then
  stop), moves and breaks the mock oracle, checks demand (idle machines left alone, stale tables with nobody playing
  cost nothing), the daily cap and spend metric, wake and status, the miss breaker (opens closed, not paused, no spend), a fake second source and a fake Telegram, holds the
  lock, jams a nonce, kills the RPC, and finally kills the coordinator so the keeper's `pauseIfVrfDown` pauses the
  contract, asserting each outcome on chain.
- `pnpm keeper:simulate [--mix 100,0,0]`: bankroll risk.

## When the contract changes

Every Arclaw call the keeper makes is in `lib/keeper/arclaw.ts`. After new contracts land: `forge build`,
`node script/export-abi.mjs` (regenerates `lib/abi`), adjust that file, `npx tsc --noEmit`, `pnpm keeper:e2e
--worktree`. Mirrored constants (`PUBLIC_REVEAL_AFTER`, `RESCUE_AFTER`, `SEALED_REFUND_AFTER`, `MAX_RETRIES`) are at
its top; table building mirrors `Deploy.s.sol` (`lib/keeper/table.ts`, checked by `pnpm keeper:fixture` and
`pnpm keeper:test`).
