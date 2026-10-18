/**
 * Makes the mainnet key bundle: one text file OUTSIDE the repository (default: the Desktop) holding every wallet the
 * mainnet deployment needs, with its private key, plus the plan for the Safes and the funding. It prints addresses only.
 *
 *   node scripts/mainnet/keys.mjs [--out <path>] [--force]
 *
 * It refuses to overwrite an existing file (a second run would orphan the funded wallets). Back the file up somewhere
 * safe, then delete it from the Desktop; later scripts (safe.mjs, deploy.mjs) read it with --keys <path> and append the
 * addresses they create.
 *
 * Roles:
 *   deployer   sends the deployment, the Safe creations and the funding. Holds only gas and the float until moved.
 *   signer1-3  the three owners of the Safes (2 of 3). They are hot wallets made here so the Safes work today; replace
 *              them with hardware wallets by adding the new owner and removing these through a Safe transaction.
 *   operator   reprices the prize tables (operatorSetPrizes). Hot, limited by the on-chain rules.
 *   keeper     reveals and retries (KEEPER_PRIVATE_KEY in the Convex environment). Hot, holds only gas.
 *   guardian   may pause the contract, never unpause. Hot.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const out = value("--out") ?? join(homedir(), "Desktop", "arclaw-mainnet-keys.txt");
if (existsSync(out) && !flag("--force")) {
  console.error(`${out} already exists. Not overwriting it (the wallets in it may hold funds). Use --force only if it is empty.`);
  process.exit(1);
}

const ROLES = [
  ["deployer", "Sends the deployment and the Safe creations, funds the other wallets and the float. Fund THIS one."],
  ["signer1", "Safe owner 1 of 3."],
  ["signer2", "Safe owner 2 of 3."],
  ["signer3", "Safe owner 3 of 3."],
  ["operator", "Reprices the prize tables inside the on-chain rules."],
  ["keeper", "Reveals fulfilled opens and retries expired ones. Its key goes into the Convex environment."],
  ["guardian", "Can pause the contract, never unpause."],
];

const wallets = ROLES.map(([role, note]) => {
  const key = generatePrivateKey();
  return { role, note, key, address: privateKeyToAccount(key).address };
});

const line = "=".repeat(78);
const text = `${line}
ARCLAW MAINNET KEY BUNDLE
Created ${new Date().toISOString()}
${line}

KEEP THIS FILE SECRET. Anyone who has it controls these wallets and, until the owner is moved to a hardware
signer set, the whole deployment. Back it up in two safe places (password manager plus an encrypted drive), then
DELETE it from this machine. Never paste it into a chat, a ticket, a repository or an email.

This file was written by scripts/mainnet/keys.mjs. Later scripts read it (--keys <path>) and append to it.

${line}
1. WALLETS (Arc mainnet, chainId 5042, USDC is the gas token)
${line}

${wallets
  .map(
    (w) => `${w.role.toUpperCase()}
  address:     ${w.address}
  private key: ${w.key}
  purpose:     ${w.note}
`,
  )
  .join("\n")}
${line}
2. WHAT TO FUND (USDC on Arc mainnet)
${line}

Send everything to the DEPLOYER address only. The deploy script spreads it:

  deployer          25 USDC   gas for the deployment and the Safes (it stays on the deployer)
  operator          50 USDC   gas for hourly reprices (about 2 USDC a day)
  keeper            50 USDC   gas for reveals and retries
  guardian           5 USDC   gas for an emergency pause
  signer1/2/3        5 USDC   each, gas for Safe transactions
  contract float   500 USDC   the reserve floor inside the Arclaw contract (pays the big wins)

  total to send to the deployer: 640 USDC

Test plays on mainnet are paid from your own wallet and are extra.

${line}
3. SAFES (filled in by scripts/mainnet/safe.mjs and deploy.mjs)
${line}

OWNER SAFE (2 of 3 of signer1, signer2, signer3): owns Arclaw, LuckVault, AstockPriceSource, ArclawLinks
  address: (not created yet)

TREASURY SAFE (2 of 3, same signers): receives withdrawn profit and funds the monthly ARCLAW buyback
  address: (not created yet)

To replace the generated signers with hardware wallets: from the Owner Safe add the new owner (addOwnerWithThreshold),
then remove signer1..3 (removeOwner). scripts/mainnet/safe.mjs exec does this with the keys above.

${line}
4. DEPLOYED CONTRACTS (filled in by deploy.mjs)
${line}

(not deployed yet)

${line}
5. ENVIRONMENT TO SET AFTER DEPLOY (the scripts do the Vercel and Convex parts)
${line}

Vercel (production):  NEXT_PUBLIC_ARC_NETWORK=mainnet, APP_ORIGIN=https://arclaw.app
Convex (production):  KEEPER_PRIVATE_KEY (the keeper key above), ALERT_TELEGRAM_CHAT_ID (optional)
Token: after ARCLAW exists, set its address in lib/token.ts and call LuckVault.setLuckToken from the Owner Safe.
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text, { flag: flag("--force") ? "w" : "wx" });
console.log(`Wrote ${out}\n`);
for (const w of wallets) console.log(`${w.role.padEnd(9)} ${w.address}`);
console.log("\nSend 640 USDC (Arc mainnet) to the DEPLOYER address. Back the file up, then delete it from the Desktop.");
