# arclaw on Solana and MagicBlock

The claw machine, as an arcade you play from your phone: pay Circle USDC, steer a real claw in real time, and every play
wins a sealed box that opens into a pack of three tokenized stock cards.

## Pieces

| Layer | What runs there |
|---|---|
| Solana | the `arclaw` program: USDC payments, sealed boxes, the outcome tables, the stock vault, settlement, gifts |
| MagicBlock ephemeral rollup | one claw round at a time: joystick moves (gasless, a few ms), the drop, the VRF callback |
| MagicBlock VRF | the draw: one verifiable random word per round, delivered to `reveal_round` on the rollup |
| Wallets | any Wallet Standard wallet (Phantom, Solflare, Backpack), Mobile Wallet Adapter on Android |
| Convex | the leaderboard indexer (reads `Played` and `RoundSettled` from the program's transactions) |

## A round

```
Solana    play(machine, n)            USDC to the treasury, n sealed boxes on the Player account
Solana    start_round + delegate      1 wallet signature: fund a session key, burn a box into a Round, delegate it
ER        move_claw(dx, dz) x many    signed by the session key in the tab: no prompt, no fee
ER        drop_claw(seed)             VRF request on the ephemeral queue
ER        reveal_round(randomness)    VRF callback: one weighted draw from the machine's table
ER        finish_round                commit the Round to Solana and undelegate it
Solana    settle_round                1 wallet signature: pay three cards from the vault, close the Round,
                                      sweep the session key's SOL back
```

The claw is theatre: where it drops does not change the odds. The VRF word and the on-chain weighted table decide.

A round is void, and its box comes back at settle, when it is ended before the drop (driver or player), when the draw
has not landed 120 s after the drop (anyone), or when the machine's table was replaced between start and draw. Drawn
rounds can be sent home by anyone (so a keeper can finish what a closed tab left), and anyone can settle; the cards and
rent always go to the player.

## Program rules (same as the Arc version)

- Each outcome is a full pack of three cards. Every table is checked when it is set: each pack worth at least
  `floor_bps` (never under 50%) and at most `cap_bps` of the price, the weighted expected value inside
  `[rtp_min_bps, rtp_max_bps]` (never over 95%).
- A machine's price is fixed once set. Changing a machine's rules clears its table.
- The price of every sold, unsettled box is reserved (`sealed_reserve`), and so is what the treasury owes
  (`owed_total`): `withdraw` only takes the rest.
- A card the vault cannot cover is refunded at its table value in USDC from free funds; if there are none, it is
  recorded as owed and the player claims it later (`claim_owed`).
- Tables older than `max_table_age` cannot start a round (0 turns this off; devnet uses 0 because its stock prices are
  a snapshot).

## Trust model and what is not ported yet

- **Prize stock is not reserved.** The admin can `sweep` stock out of the vault. A drawn card the vault no longer holds
  is refunded at table value, so the player gets the money but not the stock. Keep the admin key in a multisig
  (Squads) on mainnet.
- **No live price check.** The Arc contract re-checked every card against an oracle at open. Here values are set by the
  admin or operator with the table, and `max_table_age` bounds how stale they can get. Adding a Pyth check in
  `start_round` is the next step for mainnet.
- **No just in time buys.** The Arc contract bought a missing card on the Astock desk at reveal. On Solana the vault is
  pre-filled (on mainnet: xStocks bought on Jupiter by the operator) and a short card is refunded.
- **Not ported:** the ARCLAW luck boost, the VRF miss breaker, `refund_sealed` for a machine switched off for days, the
  keeper (table repricing on a schedule) and the admin panel.
- **Not audited.** The Arc contract went through several audit rounds; this program has had none yet. The CLAUDE.md
  rule holds: two independent audits and green tests before any mainnet deploy.

## Tokens

| | Devnet | Mainnet |
|---|---|---|
| USDC (Circle) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Stocks | test mints from `scripts/solana/setup.ts` (SPL, 8 dp) | xStocks (Token-2022); the program accepts both token programs |

Devnet USDC comes from https://faucet.circle.com.
