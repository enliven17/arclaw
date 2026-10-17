# arclaw tokenomics

Source of truth for odds: `lib/machines.json`. This file explains the shape and the treasury rules around it.

## Machines

Bigger machine, better odds. Rarity of the top three tiers is the same everywhere; the money back tiers get richer as the price goes up.

| Tier | Pack value | Single 1 USDC | Stack 5 USDC | Vault 10 USDC |
|---|---|---|---|---|
| Common | 0.5x | 53.10% | 39.80% | 26.47% |
| Uncommon | 0.8x | 23.45% | 31.75% | 40.08% |
| Rare | 1x | 20.00% | 25.00% | 30.00% |
| Epic | 2x | 2.50% | 2.50% | 2.50% |
| Legendary | 4x | 0.80% | 0.80% | 0.80% |
| Jackpot | 10x | 0.15% | 0.15% | 0.15% |
| Return to player | | 75.0% | 80.0% | 85.0% |
| Boxes at 1x or better | | 23.5% | 28.5% | 33.5% |
| House edge | | 25.0% | 20.0% | 15.0% |

Guarantees, enforced on-chain per machine: every box is worth at least 0.5x (floor), never more than 10x (cap), and the table's expected return sits inside the band (60 to 88%).

## Margin after costs

| Cost | Size | Note |
|---|---|---|
| VRF fee | about 0.02 USDC per request on mainnet | one request covers up to 20 boxes, so batch opens |
| Desk spread | about 0.35% of payout | inventory is bought on the Astock desk |
| Gas | negligible | paid by the player, or sponsored for passkey wallets |

Net margin per box opened alone: about 23% (Single), 19% (Stack), 14.5% (Vault). Variance is low for the house: the edge beats one standard deviation of luck within about 45 plays, and the 10x jackpot at 0.15% is the only tail that matters.

## Treasury rules

1. **Price is fixed per machine.** A machine's price never changes after creation. New price means a new machine id. (Audit #1 H-01.)
2. **Liabilities first.** Owed credits and pending refunds are reserved; `withdraw` and `spend` can only touch the free balance. (Audit #1 M-02.)
3. **Fresh tables only.** A table records when it was priced. `open` refuses a table older than `maxTableAge` (24 h default), and pricing refuses stale oracle reads (`isStale`). A keeper reprices every few hours and after big market moves.
4. **Reveal fast.** A keeper reveals fulfilled openings within seconds, so nobody holds a free option on a stale table.
5. **Inventory float.** Hold enough of each stock for at least 5 Vault jackpots plus one day of expected payouts; refill from the desk when below. Desk capacity is 500 USDC per stock per trade.
6. **Inventory is market exposure.** Held stock moves with the market; keep the float small and reprice tables instead of hoarding inventory.
7. **Retries cost the caller.** Only the opener or the operator retries an expired VRF request for free; the old request is refunded before a new one is made. (Audit #1 L-01, M-01.)

## Not legal advice

Paying for a chance at a prize of value is regulated as gambling in many places, whatever the floor. Mainnet needs a legal opinion, age gating and geo blocking before launch.
