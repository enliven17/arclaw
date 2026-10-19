# Security

What can hurt arclaw, what stops it, who holds which key, and what is still open. Written for the team; the user-facing
version is section 6 and 9 of the whitepaper (`/whitepaper`).

## What is at stake

Player money is reserved inside the Arclaw contract (unopened boxes, pending opens, credits, refunds). Prize inventory and the
float sit there too. The Astock tokens are other people's assets we only hold briefly. The site and the Telegram bot can
hurt people indirectly (fake pages, phishing), so they are in scope.

## Roles and keys

| Role | Who | Can | Cannot |
|---|---|---|---|
| Owner | a Safe, 2 of 3 | everything configurable: machines, guards, policy, desk, vault, pause and unpause, withdraw above the reserves | touch reserved funds, lower the floor or the lower RTP bound, renounce ownership |
| Operator | hot key | reprice tables (`operatorSetPrizes`) inside each machine's on-chain band, restock inside the daily cap | anything else |
| Keeper | hot key (Convex env) | reveal, retry, return expired opens | reprice outside the rules, withdraw |
| Guardian | hot key | pause | unpause |
| Deployer | one key | deploy once, then nothing: ownership moves to the Safe in two steps (Ownable2Step) | |

The mainnet bundle (`scripts/mainnet/keys.mjs`) generates all of these plus the three Safe signers. The signers are hot
wallets created so the Safes work on day one: replace them with hardware wallets (add the new owner, remove these through
a Safe transaction, `scripts/mainnet/safe.mjs exec`) before real money is at risk. Treat the key file as the
crown jewels: two offline backups, deleted from the machine that made it.

## Controls in the contracts

- Reserves first: `withdraw`, `spend`, `sweep` and just-in-time buys can only use what is above sealed, pending, credit and
  owed reserves, and never below the reserve floor. The native USDC alias at `0x3600…` cannot be swept.
- Odds cannot be quietly worsened: each machine has its own return band, the floor is checked at pricing and again at open
  (live prices), the cap is enforced, and the floor and lower bound only move up. A table outside the band is rejected.
- Fresh tables: a table older than a day or any price more than 5 percent off its reference refuses opens. `open` takes the
  table id the player saw.
- Exits: unopened boxes can be burned for the price paid after the machine is off, a table is stale or the contract is paused
  for three days. Expired VRF requests can be retried within limits or returned.
- VRF miss breaker: every opening whose request expired counts as one miss, on the day it is first retried or returned.
  `maxMisses` misses in a UTC day close `open` (error `VrfMisses`) until 00:00 UTC; plays, reveals, retries and returns go
  on. A trip runs the refund clock like a pause, so a VRF that keeps missing opens `refundSealed` three days after the
  first trip. A trip while the contract is already paused leaves the running pause clock alone (round 6), so returning
  expired openings during a pause cannot push `refundSealed` back. The counter saturates at `maxMisses`. It reopens by
  itself: the keeper should alert on a trip and the guardian pause on repeated trips.
- Price source swaps (`setPolicy` with a new source) only while paused. A swap holds `resumedAt` four days past it, and
  the pause clock counts until `resumedAt` plus one day of service, so the refund clock keeps running until five days
  after the swap: swapping in a reverting source cannot lock unopened boxes without the clock running.
- Settle pauses (round 6): a reveal, retry or return pauses play only when it creates a new IOU or leaves the unreserved
  balance under `minBuffer`. An IOU the owner has funded does not re-pause the contract while its holder never claims.
- Machines: switching a machine off starts its refund clock, kept across a switch back on for a day of service. A
  machine that never sold a box drops its off clock when switched on (round 6): no box of it exists to protect, so a
  machine left off at deploy does not open `refundSealed` on its first day of service.
- The house VRF subsidy only comes from the unreserved balance; when that is empty the opener pays the full fee.
- Payments: no return-data copy, a 100k gas cap on pushes with a credit fallback, reentrancy guards on every state change.
- Randomness: D20DAO VRF (drand evmnet beacon, verifiable on chain, 60 second window, refund after). See the whitepaper for
  the trust assumptions.

## What was reviewed

Eight rounds, each by two independent AI-assisted reviewers writing exploit tests (`contracts/test/audit1` to `audit8*`),
plus a red-team pass over the economics, the keys, the web app and the API (October 2026; findings are in the
commit history). Every finding became a test. The suite also has invariant tests (liabilities always backed, reserves
match). This is **not** a professional audit firm's work; one should be commissioned before large volumes.

## Open risks and the plan

| Risk | Status |
|---|---|
| VRF withholding: a prover who sees a bad draw lets it expire so a retry redraws | Mitigated in the contract by the retry rules; the residual trust in the randomness operator is stated in the whitepaper. Monitor the retry rate (keeper alert). |
| Oracle or desk misbehaviour | Staleness checks, a 5 percent guard, a second price source in the keeper, a refund path capped at the lower of table and last price. A token pause means removing it from the tables (runbook). |
| Hot key compromise (operator, keeper, guardian) | Each can only do its narrow job; rotate and pause. Owner is a Safe. |
| Owner = hot signers until replaced by hardware wallets | Replace before volume. |
| Legal (gambling, securities, sanctions) | Region gate and age confirmation exist; counsel must set the real list (`BLOCKED_COUNTRIES`). Holder distribution wording reviewed in the disclaimer. |
| Web: XSS, clickjacking, fake share cards | CSP and framing denied, signed share links, no user HTML. Embedded wallets sign without a prompt by design (the play button is the confirmation). |
| Supply chain (ConnectKit, wagmi, WalletConnect tree) | Lockfile installs, review upgrades, `pnpm audit` on release. |
| Telegram bot token | It was shared in a chat once, so rotate it when convenient; the webhook has a secret header. |

## Known trust assumptions

Accepted on purpose, not fixed in code (audit rounds 7 and 8). The Owner Safe is the mitigation for every owner item; a
Safe delay module (a timelock on owner transactions) is the planned next step, and it must cover the owner calls of
`AstockPriceSource` and `LuckVault` too, not only Arclaw's.

| Assumption | Why it stays |
|---|---|
| Owner can zero a pending refund (7b M-01): once a word is public, the owner can sweep the drawn stock and point the price source at a dust or broken price, so the short cards refund at almost nothing, without an IOU, and the reserved box price becomes free balance | Refunds have to follow the price source (a fall in the stock must not be cashed out at the old price), and sweeping inventory is how the treasury is run. Mitigation: owner is a Safe, later a Safe delay module so players see a swap coming. |
| Other owner knobs can also stall opens while a table still counts as fresh: an owner-controlled price source that toggles, `setGuards` with a 1 bps move limit, raising the floor one step at a time | Same as above: owner trust. A stalled machine still reaches `refundSealed` once its table is left to age out. |
| Miss counter resets at 00:00 UTC: a burst straddling midnight can book up to 2 x maxMisses - 1 misses before the breaker closes `open` | Daily window by design; the keeper alerts on miss rate, the guardian pauses. |
| Misses booked late: an opening that expired while its table aged out before the keeper could retry, and was never retried, books its miss on the day it is returned. A holder of many such openings (only possible during a real VRF outage) can close `open` until midnight on a day of their choice | The alternative (booking on the request day) would make a late return a free re-roll. It closes only `open`, only until midnight, never pauses. |
| The deploy-time pause starts the refund clock: if the owner unpauses two or more days after deploying, `refundSealed` is open to everyone during the first day of service | Neutral (a refund at the price paid), and the launch is short. Unpause within a day of deploying, or expect early refunds. |
| A retried opening that is later returned books one miss for two dropped words (8a/8b L-01), so the breaker bounds about 2 x (maxMisses - 1) re-rolls a day, not maxMisses (about 29 USDC a day on Vault at the default 10) | Booking the return as well brings back the round 4 double count, which let stored misses close `open` on demand. Each re-roll still needs an expired request, an aged-out table and a new open. Keeper alerts on the retry rate; the guardian pauses. |
| A VRF that accepts requests but never answers, under maxMisses openings a day, gives no on-chain exit (8a L-02): the breaker never trips, `pauseIfVrfDown` reverts `VrfAlive` (the request goes through) and, while tables are repriced, `refundSealed` never opens | The guardian is load-bearing here: the keeper alerts (`vrf-retry-expired`, `vrf-retry-rate`) and the guardian pauses, which starts the refund clock. |
| The owner can close `open` for the rest of a UTC day without any refund clock by lowering `maxMisses` under today's count (`setLimits`, 8a I-02) | Owner trust, one day at most per call; the Safe (and later its delay module) is the mitigation. |
| `AstockPriceSource.setUnderlyings` remaps or unmaps a card token at once, unpaused and without the `setPolicy` hold (8b INFO-01), so the `setPolicy` pause rule is not a control against the owner key: opens can halt while the table still counts as fresh and no clock runs | Owner trust: the price source has the same owner. The Safe delay module must cover the price source's owner calls too. A stalled machine still reaches `refundSealed` once its table ages out. |

## Incidents

1. Pause (guardian or owner) first, ask questions after: sealed boxes can always exit after three days.
2. Rotate the compromised key (keeper: new key into Convex env; operator: `setOperator` from the Safe).
3. Reprice or pull a token from the tables if the oracle or desk is the cause.
4. Tell players what happened on X the same day.

## Audit 9 note

Round 6 was audited twice more with no Medium or higher findings. An IOU that loses its backing again (a VRF top-up payback) can leave a funded IOU short by up to one VRF fee. The deploy script now sets `minBuffer` to 1 wei, so the contract pauses whenever nothing is left unreserved, and the guardian may no longer be the deployer. Fund `totalOwed` plus a little before every unpause.
