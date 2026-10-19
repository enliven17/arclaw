# Audit round 10, reviewer B

Scope: `src/Arclaw.sol` (with the `ArclawRules` and `ArclawPayout` libraries), `ArclawLinks.sol`, `LuckVault.sol`, `ArclawLens.sol`,
`AstockPriceSource.sol`, `vrf/D20Randomness.sol`, `vrf/RandomnessSource.sol`, `interfaces/`, plus the mainnet deploy
parameters in `script/Deploy.s.sol` and `scripts/mainnet/deploy.mjs`. I reviewed this independently and did not read
`test/audit10a/`. `src/` did not change while I worked (`git diff 2f865c1 HEAD -- contracts/src` is empty). `deploy.mjs` did
change: commit 2e1c09f (audit 10a) made the reserve floor follow the planned float.

## Summary

Nothing above Info. I found no Critical, High, Medium or Low issue.

| ID | Severity | Title | Proven |
|---|---|---|---|
| INFO-01 | Info | An aged LuckVault position can be sold along with its smart account, so the buyer gets the full boost at once | yes |

## INFO-01: an aged LuckVault position can be sold along with its account

- Location: `src/LuckVault.sol:91-98` (`boostOf` reads `stakes[player].since`) and `src/Arclaw.sol:453` (`_boostOf(msg.sender)`).
- What happens: the 24 h age belongs to the staking address, not to a person. If that address is a transferable account
  (a Safe, an ERC-6551 token-bound account, any ownable wallet), the aged position changes hands with it. The buyer
  opens through the account and gets the full boost in the same block, using tokens they never held for `minAge`.
- Exploit steps: (1) Alice's account stakes 1000 ARCLAW. (2) 24 h pass. (3) Alice transfers ownership of the account to
  Bob (an off-chain or NFT sale). (4) Bob moves a box into the account and calls `open` through it: `openingBoost` is 100.
- Impact: no loss to the house. The economics are the same as the boost renting already accepted in the NatSpec of
  `_boostOf`, and every table's RTP band is checked at `MAX_BOOST_BPS`. What breaks is the wording of the product rule
  "flash-loaned or freshly bought tokens must not count": it holds for tokens, but not for a bought position.
- Proof: `test/audit10b/A10bFindings.t.sol::test_info01_agedStakeSoldWithItsAccount`.
- Minimal fix: none needed on chain (you cannot tell an account sale from a long-term holder). Say in the docs and
  whitepaper that boosts can be rented or sold, as already accepted.

## Areas checked and found clean

Each area below was attacked and either proven by a test or verified by reading the code.

- Economic invariants (new stateful suite `A10bInvariant.t.sol`). This is mainnet-like: no prize inventory, so every card is
  bought just in time (JIT) on the desk; a 3 USDC float under a 5 USDC `reserveFloor`; `setGuards(500, 1)` and
  `setJit(desk, 100, 60, 60e18, 5e18)` as in `Deploy.s.sol`; prices drifting up to 20 percent (breaking the 5 percent
  guard, then repriced); VRF fees spiking above the subsidy (top-ups); a boosted opener; starved callbacks; outside D20
  refunds; retries by the opener, the keeper and strangers; returns; rescues; IOUs; `claimOwed` and `claimCredit`; and the
  owner withdrawing all of `freeBalance` and topping up and unpausing at random. The invariants hold:
  - credit, pending, sealed and top-up reserves are always backed by the balance plus the fees D20 still escrows,
  - `sealedReserve` equals the price of every sealed box held,
  - `pendingReserve` equals the boxes of unrevealed openings,
  - `totalOwed` equals the sum of `owed`,
  - every share minted by the desk is either in inventory or counted in `paidOut`,
  - cards paid plus cards refunded never exceed 3 per opened box.

  A temporary probe invariant confirmed the campaign reaches reveals, JIT buys, refunds and IOUs.
- Refunds never pay more than was paid. `refundSealed` pays exactly the immutable price. A returned top-up is never more
  than the opener sent: `required` is never more than `msg.value`, and the change is pushed back. A card refund is the lower
  of its value at table time and its value at the last price, so it is never worth more than the stock, and rescue is
  never better than reveal.
- Draw manipulation. Once a word is fulfilled, the opener has no choice left. `retry` and `returnBoxes` need
  `_requireExpired` (`AlreadyFulfilled` even when the callback failed), and the 7-day path needs `_randomnessLost`, which is
  false once fulfilled. The boost is fixed at open, before the request. The luck stream is independent of the main draw.
  Keepers and third-party revealers can change only the timing, never the outcome. Their only lever is stock versus USDC
  refund (JIT cap, free balance, oracle staleness), and a refund is never worth more than the stock.
- JIT desk buy. `minSharesOut` equals the shortfall, the delivered amount is checked by balance difference, and the cost is
  capped by `maxPerCard`, `jitCap` and the free balance (the free balance includes `refundSoFar`; it never counts reserves
  or IOUs). A desk that delivers short or nothing, or a fee-on-transfer card, leaves the card refunded and the
  accounting intact. On a mainnet fork (`A10bFork.t.sol`, `A10B_FORK=1`), the real Astock desk fills Common-tier cards of
  about 0.16 USDC at the 1 percent slippage.
- ArclawLinks. The EIP-712 domain binds the chain and the contract. `linkKeyUsed` blocks reuse of a link key, the status
  flip blocks replay, and the expiry windows of claim and reclaim do not overlap. A front-runner can only deliver the boxes
  to the signed recipient. Batch transfers and data-less transfers are refused, and `from == address(0)` is unreachable.
- LuckVault. Stake and unstake are `nonReentrant`. The fee-on-transfer-safe `got` is used both for the stake and for
  `totalStaked`. A top-up restarts the clock; a partial unstake keeps it but lowers the tier. Nobody can stake into, or
  reset, someone else's position. The token can only change at `totalStaked == 0`.
- Access control. Every external function was checked: players (play, gift, open, reveal, rescue, retry, returnBoxes,
  refundSealed, claims, pauseIfVrfDown), the operator (operatorSetPrizes, spend), the guardian and owner (pause), the owner
  only (every setter, unpause, withdraw, sweep), the coordinator only (rawFulfillRandomness, onRefund), and the library
  call guards. `pauseIfVrfDown` is the one unguarded state change that external code can reach from inside a guarded call
  (via a `_pay` receiver or an ERC-1155 mint hook). It either reverts with `VrfAlive` or makes a legitimate pause.
- Gas and freezing. Native pushes are capped at 100k gas with a credit fallback and no returndata copy. The boost read
  has a 100k cap. Payout calls are all try or staticcall, and a reveal is bounded at 20 boxes x 3 cards and 60 buys.
- VRF probe on the live D20 (fork): `pauseIfVrfDown` reverts with `VrfAlive`. On a real D20 expiry and keeper retry, the old
  fee comes back, the opener's over-payment is returned as change, and no IOU or pause follows.
- Deploy parameters. `Deploy.s.sol` mainnet:
  - the contract is paused before `_configure`, and `setPolicy` runs before any table exists,
  - guardian and keeper are required and differ from the deployer,
  - `minBuffer` is 1 wei, the 5 percent move guard is on, JIT is 1 percent, 60 buys, 60 USDC per card,
  - `jitCap` is 2000 and `maxMisses` 10,
  - Stack and Vault are off and have never sold a box, so their off clock is dropped on enable,
  - ownership of Arclaw, the price source and the vault goes to the Safe (Ownable2Step; `deploy.mjs` accepts before it
    funds).

  On a fork with no inventory and a 3 USDC float, one Single Legendary (4x, p = 0.8 percent) already creates an IOU and
  pauses the contract. That is the small-float risk already documented (audit 7a L-02, `docs/DEPLOY.md` "Known limits of a
  small float"), so it is not re-reported. Fund the float before `unpause`.

## Tests

- `test/audit10b/A10bFindings.t.sol`: INFO-01.
- `test/audit10b/A10bInvariant.t.sol`: 6 invariants over 17 handler actions (also ran 300 runs x 120 depth, 36,000 calls
  each, all passing).
- `test/audit10b/A10bFork.t.sol` (opt-in `A10B_FORK=1`, mainnet fork with the real Deploy script, D20, desk and oracle):
  launch Single at every tier, the live D20 probe, and a real D20 expiry and retry.

Results: `forge test --match-path "test/audit10b/*"` gives 10 passed, 0 failed (the fork tests are no-ops without
`A10B_FORK`; with `A10B_FORK=1` all 3 pass on the fork). The full `forge test` gives 302 passed, 0 failed, 0 skipped, in 46
suites.
