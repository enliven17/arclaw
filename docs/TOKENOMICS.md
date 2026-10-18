# arclaw tokenomics

Source of truth for odds: `lib/machines.json`. This file explains the shape and the treasury rules around it.

## Machines

Bigger machine, better odds. Rarity of the top three tiers is the same everywhere; the money back tiers get richer as the price goes up.

| Tier | Pack value | Single 1 USDC | Stack 5 USDC | Vault 10 USDC |
|---|---|---|---|---|
| Common | 0.5265x | 56.06% | 41.99% | 27.91% |
| Uncommon | 0.8x | 23.45% | 31.75% | 40.08% |
| Rare | 1x | 17.04% | 22.81% | 28.56% |
| Epic | 2x | 2.50% | 2.50% | 2.50% |
| Legendary | 4x | 0.80% | 0.80% | 0.80% |
| Jackpot | 9.9x | 0.15% | 0.15% | 0.15% |
| Return to player | | 75.0% | 80.0% | 85.0% |
| Return at max luck boost | | 75.2% | 80.2% | 85.2% |
| Boxes at 1x or better | | 20.5% | 26.3% | 32.0% |
| House edge | | 25.0% | 20.0% | 15.0% |

These are the values deployed. The Common pack is built 5.3% above the 0.5x floor (0.5265x) so a price dip inside the 5% guard never pushes it under the floor between reprices; `lib/machines.json` states it at that value, so its weights give the realised RTP directly. The Jackpot is listed at the 10x cap in `lib/machines.json` and built 1% under it (9.9x) so a one tick oracle move cannot push it over the cap; that costs 0.015 points of RTP.

Guarantees, enforced on-chain per machine: every box is worth at least 0.5x (floor, checked again at live prices on every open), never more than 10x (cap), and the table's expected return, including the maximum luck boost, sits inside that machine's own band: Single 74 to 76%, Stack 79 to 81%, Vault 84 to 86%. The lower edge can only go up after deploy, so no reprice can take a machine more than one point under its advertised return.

## Margin after costs

| Cost | Size | Note |
|---|---|---|
| VRF fee | about 0.02 USDC per request on mainnet | one request covers up to 20 boxes, so batch opens |
| Desk spread | about 0.35% of payout | inventory is bought on the Astock desk |
| Gas | negligible | paid by the player, or sponsored for passkey wallets |

Net margin per box opened alone: about 23% (Single), 19% (Stack), 14.5% (Vault). Variance is low for the house: the edge beats one standard deviation of luck within about 45 plays, and the 10x jackpot at 0.15% is the only tail that matters.

## Revenue funds payouts

The box price pays for its own pack. When a revealed card's stock is not in inventory, the contract buys it just in time on the Astock desk with the box revenue (allow-listed desk, slippage bounded by the price source, capped per card and per reveal) instead of refunding. A refund only happens if that buy is impossible (desk down, cap hit, oracle stale).

| Tier | Pack value | Covered by the play itself? |
|---|---|---|
| Common | 0.5265x | yes, with 0.4735x left over |
| Uncommon | 0.8x | yes |
| Rare | 1x | yes, exactly |
| Epic | 2x | needs 1x from the float |
| Legendary | 4x | needs 3x from the float |
| Jackpot | 9.9x | needs 8.9x from the float |

About three boxes in four leave money behind (that is the house edge), and that surplus refills the float. Only Epic and better (3.45% of boxes) draw on it, so the treasury does not need deep pre-bought inventory: a `reserveFloor` of roughly one Vault jackpot plus one Legendary (about 120 USDC) covers the tail. `withdraw` and `spend` can never touch the floor; just in time buys can.

## Treasury rules

1. **Price is fixed per machine.** A machine's price never changes after creation. New price means a new machine id. (Audit #1 H-01.)
2. **Liabilities first.** Owed credits and pending refunds are reserved; `withdraw` and `spend` can only touch the free balance. (Audit #1 M-02.)
3. **Fresh tables only.** A table records when it was priced. `open` refuses a table older than `maxTableAge` (24 h default), and pricing refuses stale oracle reads (`isStale`). A keeper reprices every few hours and after big market moves.
4. **Reveal fast.** A keeper reveals fulfilled openings within seconds, so nobody holds a free option on a stale table.
5. **Native float, not stock hoard.** Keep `reserveFloor` (about 120 USDC) in native USDC for Epic and better; cards are bought just in time at reveal. Pre-buying stock with `spend` is optional (it saves the desk spread on hot tickers). Desk capacity is 500 USDC per stock per trade.
6. **Inventory is market exposure.** Held stock moves with the market; keep any pre-bought inventory small and reprice tables instead of hoarding it.
7. **Retries cost the caller.** Only the opener or the operator retries an expired VRF request for free; the old request is refunded before a new one is made. (Audit #1 L-01, M-01.)

## ARCLAW holders

Two separate things. Only the first is code.

**1. Luck boost (on-chain, LuckVault).** ARCLAW locked in the vault for at least 24 hours (minAge) gives a boost between 0 and 1% (100 bps). With probability boost/10,000 a box draws a second pack from an independent random stream and keeps the better one. The stake tiers and their boosts (for example 1k, 10k and 100k ARCLAW for 0.25%, 0.5% and 1%) are set by the owner after the token exists; until then boosts are off. Flash-loaned or freshly bought tokens earn nothing, and unstaking is instant.

What it is worth at the top tier: about 0.16 percentage points of return (about 1.6 USDC per 1,000 USDC played; 0.16 cent per Single box, 0.8 cent per Stack box, 1.6 cent per Vault box). It is a small perk, by design: every table is checked on-chain at the maximum boost, so the house edge cannot be bent by it.

**2. Buyback and holder distribution (off-chain, run by the team).** Not in any contract and not enforced on-chain. The team's policy, each month from the net profit of the month (after VRF fees, desk spread and the other costs above):

| Share of monthly net profit | What happens |
|---|---|
| 25% | Buyback: the team buys ARCLAW on the market |
| 10% | Distribution to ARCLAW holders (the team picks the snapshot and the method) |

The two are separate, so 35% of the month's net profit goes to the token in total and 65% stays with the project. The percentages are the team's current policy, not a contract term: the team can raise them as profit grows (larger buybacks and distributions are the plan), and changing them needs no audit because the contracts know nothing about it. It is not a guaranteed yield; if there is no net profit in a month there is nothing to buy or distribute.

Not decided yet and not written anywhere: ARCLAW total supply, allocation and launch plan (it is minted later on Arguspad; the owner sets its address in the vault).

## Not legal advice

Paying for a chance at a prize of value is regulated as gambling in many places, whatever the floor. Mainnet needs a legal opinion, age gating and geo blocking before launch.
