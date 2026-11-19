# arclaw program (Solana + MagicBlock)

Anchor 1.2.2, `ephemeral-rollups-sdk` 0.20 (delegation, commit, VRF). Source in `programs/arclaw/src`:

| File | What |
|---|---|
| `lib.rs` | instructions and account structs |
| `state.rs` | Config, Machine, Player, Round, Link |
| `rules.rs` | floor, cap and RTP checks and the weighted draw (pure, unit tested) |
| `errors.rs` | error codes (the app maps them in `lib/solana/client.ts`) |

Architecture and the trust model: [`../docs/SOLANA.md`](../docs/SOLANA.md).

## Build and test

```sh
cd solana
cargo test --lib                 # rules: floor, cap, RTP band, draw distribution
anchor build                     # needs the Solana toolchain (agave 3.x) and anchor-cli 1.2.2
```

`cargo check` builds the program for the host and is enough to check a change compiles; `anchor build` produces the
SBF binary.

## IDL

The app does not use an Anchor client: `lib/solana/program.ts` builds instructions by hand, and
`lib/solana/program.test.ts` checks every one against `idl/arclaw.json` (discriminators, account order, writable and
signer flags). After any change to an instruction's accounts or arguments, regenerate the IDL and run the tests:

```sh
cd solana
ANCHOR_IDL_BUILD_PROGRAM_PATH=$PWD/programs/arclaw cargo test --features idl-build __anchor_private_print_idl_program -- --show-output --quiet \
  | sed -n '/--- IDL begin program ---/,/--- IDL end program ---/p' | sed '1d;$d' > idl/arclaw.json
# then put the program id in idl/arclaw.json "address"
cd .. && pnpm test
```

(`anchor build` writes the same IDL to `target/idl/arclaw.json`.)

## Deploy to devnet

1. A keypair with devnet SOL: `solana-keygen new` and `solana airdrop 5 --url devnet` (or faucet.solana.com).
2. Program id: `anchor keys sync` writes your program keypair's id into `declare_id!` and `Anchor.toml`. Put the same id
   in `lib/deployments/solana-devnet.json` (`programId`) and `idl/arclaw.json` (`address`).
3. `anchor build && anchor deploy --provider.cluster devnet`
4. From the repo root: `pnpm solana:setup`. It makes the test stock mints, fills the vault, initializes the program
   with Circle's devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) and sets the three machines and their
   tables from `lib/machines.json`. Run it again to refresh tables or top up stock.
5. Players get devnet USDC from https://faucet.circle.com (Solana Devnet) and a little SOL for fees.

## MagicBlock endpoints

Rounds are delegated to the validator in `NEXT_PUBLIC_MAGICBLOCK_VALIDATOR` (empty = the delegation program's default,
`MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`, served at `https://devnet-as.magicblock.app`). The app's rollup RPC
(`NEXT_PUBLIC_MAGICBLOCK_RPC_URL`) must be the one that validator serves.

| | |
|---|---|
| Delegation program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| VRF program | `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz` |
| VRF queue on the rollup | `5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc` |
| VRF queue on Solana | `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh` |
