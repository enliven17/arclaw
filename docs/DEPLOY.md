# Mainnet deploy

Everything runs from `scripts/mainnet/`, reading the key bundle on the Desktop (`arclaw-mainnet-keys.txt`, outside the repo, never committed). Nothing secret is printed.

## Before you start

1. Both contract audits of the final commit are closed and `forge test` is green (`docs/SECURITY.md`).
2. `node scripts/mainnet/keys.mjs` has made the bundle. Back it up, then keep one copy off the machine.
3. The deployer holds USDC on Arc mainnet. The deploy itself costs about 1 USDC of gas; whatever is left is spread by the script.

Suggested funding: 2 USDC works (small float, see the risk below), 12 USDC is comfortable, 25 USDC makes an empty float very unlikely for a Single-only launch (keeper simulation, `docs/OPERATIONS.md`).

## Steps

```bash
node scripts/mainnet/deploy.mjs check            # balances and what it would spread
node scripts/mainnet/deploy.mjs deploy --yes     # Safes, contracts (paused, Single only), ownership, funding
node scripts/mainnet/deploy.mjs status           # paused, balance, machines
```

`deploy` writes `lib/deployments/arc-mainnet.json` and `lib/machines.resolved.mainnet.json`. Commit both. Publish the sources on the explorer so anyone can match the bytecode to this repo (a separate step, so an explorer outage cannot stop a deploy half way; safe to repeat):

```bash
cd contracts && forge script script/Deploy.s.sol --tc Deploy --rpc-url https://rpc.mainnet.arc.io --resume --verify --verifier blockscout --verifier-url https://explorer.arc.io/api/
```

Then:

1. Convex (prod): `npx convex deploy`, then `npx convex env set` for `KEEPER_PRIVATE_KEY` (the keeper wallet from the bundle), `KEEPER_NETWORK=mainnet`, `KEEPER_DEPLOYMENT_JSON` only if the JSON is not yet in the build, `ALERT_TELEGRAM_CHAT_ID` and `TELEGRAM_BOT_TOKEN` when you have them.
2. Vercel (prod): `NEXT_PUBLIC_ARC_NETWORK=mainnet`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `SHARE_SECRET`, `APP_ORIGIN`; then `vercel deploy --prod` from main. Check the WalletConnect allowed domains include the production domain.
3. Check `pnpm keeper status` (or the Convex `keeper:status` query) shows the Single table priced and healthy.
4. Play once from your own wallet while the contract is still paused to confirm the UI shows "Paused for a moment", then:

```bash
node scripts/mainnet/deploy.mjs unpause --yes
```

5. Play one real Single box, open it, sell the stock back.
6. Enable the bigger machines only after the keeper has priced them and the balance supports them (about 50 USDC for Stack, about 300 for Vault):

```bash
node scripts/mainnet/deploy.mjs enable --machine 2 --yes
```

## The ARCLAW token

When the token exists, send me the address. It goes into `lib/token.ts` and `LuckVault.setLuckToken` is called from the Owner Safe.

## Known limits of a small float

Prizes are paid from player revenue. With a float under ten times the biggest enabled price, an early jackpot can leave the contract owing the difference (an IOU) and the contract pauses itself until the keeper tops it up. Players are not lost: they can always get their money back through refunds. Raise the float by sending USDC to the Arclaw address.

## Safes

The three Safe signers are hot wallets made by `keys.mjs` so everything works today. Before real money grows, add hardware wallets as owners and remove the hot ones through a Safe transaction (`safe.mjs exec`).
