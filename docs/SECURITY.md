# Security

The Solana program (`solana/programs/arclaw`) has **not been audited**. The Arc contract it replaces went through
several audit and pentest rounds (see this file and `docs/PENTEST.md` in the git history before the Solana port); those
findings do not carry over. Rule from CLAUDE.md: two independent audits and green tests before any mainnet deploy.

## Roles

| Role | Can | Cannot |
|---|---|---|
| admin | set machines and tables, pause, change roles, withdraw free USDC, sweep vault stock | touch the reserve of unsettled boxes or owed refunds |
| operator | set tables (inside the machine's floor, cap and RTP rules) | move any funds |
| round driver (a session key in the player's tab) | move the claw, drop it, end its own round | anything outside its round; it holds 0.001 SOL, swept back at settle |
| anyone | send home a drawn round, settle any round (cards and rent go to its player) | change where a round pays |

## Checks worth a reviewer's time

- `settle_round` remaining accounts: each card's mint, vault ATA (config PDA owner) and player ATA are derived and
  compared, and the token program must be Token or Token-2022.
- `reveal_round` is only callable by MagicBlock VRF's scoped identity PDA for this program (`#[vrf_callback]`).
- `drop_claw` only accepts MagicBlock's two VRF queues.
- `finish_round` voids Armed (driver or player) and timed-out Requested rounds only; Drawn rounds go home as drawn.
- A round drawn against a replaced table is void (the box comes back), so a table change cannot be front-run.
- Claim links: the link key must co-sign `claim_link`, and the recipient is a signer of the same transaction.

## Open items

See "Trust model and what is not ported yet" in [`SOLANA.md`](SOLANA.md): stock in the vault is not reserved, card
values are not checked against a live oracle, there is no refund path for boxes of a machine switched off for good.
