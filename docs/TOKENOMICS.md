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
| Boxes at 1x or better | | 20.5% | 26.3% | 32.0% |
| House edge | | 25.0% | 20.0% | 15.0% |

Guarantees, enforced by the Solana program per machine when a table is set: every pack is worth at least 0.5x (floor), never more than 10x (cap), and the table's expected return sits inside that machine's own band: Single 74 to 76%, Stack 79 to 81%, Vault 84 to 86%. Values are the USDC values the table was set with (see docs/SOLANA.md for what is not checked live yet).

## Margin after costs

| Cost | Size | Note |
|---|---|---|
| VRF fee | MagicBlock VRF, one request per round | paid by the round's session key on the rollup |
| Swap spread | Jupiter spread when the operator buys xStocks for the vault | mainnet only |
| Fees | a few thousand lamports per Solana transaction | paid by the player in SOL; rollup moves are free |

Net margin per box opened alone: about 23% (Single), 19% (Stack), 14.5% (Vault). Variance is low for the house: the edge beats one standard deviation of luck within about 45 plays, and the 10x jackpot at 0.15% is the only tail that matters.

## Treasury rules (Solana program)

1. **Price is fixed per machine.** A machine's price never changes after it is set. Changing its rules clears its table.
2. **Liabilities first.** The price of every sold, unsettled box (`sealed_reserve`) and every owed refund (`owed_total`) is reserved; `withdraw` only takes the rest.
3. **Pre-filled vault.** Cards are paid from stock the vault already holds. On mainnet the operator buys xStocks on Jupiter with box revenue and tops the vault up. A card the vault cannot cover is refunded at its table value in USDC, or recorded as owed if the treasury has no free USDC.
4. **Fresh tables.** A table records when it was set; `start_round` refuses one older than `max_table_age` (off on devnet, whose prices are a snapshot).
5. **No re-rolls.** One VRF request per round. A draw that never lands voids the round after 120 s and the box comes back; the word itself is never seen before the callback writes the pack.

## ARCLAW holders (not ported)

The Arc version planned an ARCLAW token with a luck boost. It is not part of the Solana program; the notes below are kept for reference.

Two separate things. Only the first is code.

**1. Luck boost (on-chain, LuckVault).** ARCLAW locked in the vault for at least 24 hours (minAge) gives a boost between 0 and 1% (100 bps). With probability boost/10,000 a box draws a second pack from an independent random stream and keeps the better one. The stake tiers and their boosts (for example 1k, 10k and 100k ARCLAW for 0.25%, 0.5% and 1%) are set by the owner after the token exists; until then boosts are off. Flash-loaned or freshly bought tokens earn nothing, and unstaking is instant.

What it is worth at the top tier: about 0.16 percentage points of return (about 1.6 USDC per 1,000 USDC played; 0.16 cent per Single box, 0.8 cent per Stack box, 1.6 cent per Vault box). It is a small perk, by design: every table is checked on-chain at the maximum boost, so the house edge cannot be bent by it.

**2. Buyback and holder distribution (off-chain, run by the team).** Not in any contract and not enforced on-chain. The team's policy, each month from the net profit of the month (after VRF fees, swap spread and the other costs above):

| Share of monthly net profit | What happens |
|---|---|
| 25% | Buyback: the team buys ARCLAW on the market |
| 10% | Distribution to ARCLAW holders (the team picks the snapshot and the method) |

The two are separate, so 35% of the month's net profit goes to the token in total and 65% stays with the project. The percentages are the team's current policy, not a contract term: the team can raise them as profit grows (larger buybacks and distributions are the plan), and changing them needs no audit because the contracts know nothing about it. It is not a guaranteed yield; if there is no net profit in a month there is nothing to buy or distribute.

Not decided yet and not written anywhere: ARCLAW total supply, allocation and launch plan (it is minted later on Arguspad; the owner sets its address in the vault).

## Not legal advice

Paying for a chance at a prize of value is regulated as gambling in many places, whatever the floor. Mainnet needs a legal opinion, age gating and geo blocking before launch.
