/**
 * The mainnet deployment, step by step, driven by the key bundle from keys.mjs.
 *
 *   node scripts/mainnet/deploy.mjs check   [--keys <file>] [--rpc <url>]
 *   node scripts/mainnet/deploy.mjs deploy  --yes [--keys <file>] [--rpc <url>] [--reserve-floor <usdc>]
 *   node scripts/mainnet/deploy.mjs status  [--keys <file>] [--rpc <url>]
 *   node scripts/mainnet/deploy.mjs unpause --yes
 *   node scripts/mainnet/deploy.mjs enable  --machine 2 --yes      (after the keeper has repriced it)
 *
 * `deploy` does, in order, and each step is safe to run again:
 *   1. checks the chain (Arc, 5042) and the deployer's balance,
 *   2. creates the Owner Safe and the Treasury Safe (2 of 3 of signer1..3),
 *   3. runs contracts/script/Deploy.s.sol with owner = the Owner Safe: Single only, everything PAUSED,
 *   4. spreads the rest of the deployer's USDC to operator, keeper, guardian and the signers, and puts the float in
 *      the Arclaw contract,
 *   5. has the Owner Safe accept ownership of Arclaw, the price source and the vault (two signatures),
 *   6. appends every address and transaction to the key bundle.
 * It stops there: the contract stays paused until you run `unpause`, after the keeper is wired (docs/DEPLOY.md).
 * Keys are read from the bundle and handed to forge as its --private-key (local process only); nothing secret is printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, formatEther, parseAbi, parseEther } from "viem";
import { DEFAULT_KEYS, FEES, appendLog, args, clients, explorer, readKeys } from "./lib.mjs";
import { createSafe, execSafeTx, saltOf } from "./safe.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const ownableAbi = parseAbi(["function acceptOwnership()", "function owner() view returns (address)", "function pendingOwner() view returns (address)"]);
const arclawAbi = parseAbi([
  "function unpause()",
  "function paused() view returns (bool)",
  "function setMachineActive(uint256 id, bool on)",
  "function machineOff(uint256 id) view returns (bool)",
  "function guardian() view returns (address)",
  "function operator() view returns (address)",
  "function reserveFloor() view returns (uint256)",
]);

const { argv, flag, get } = args();
const cmd = argv[0];
const keysPath = get("--keys") ?? DEFAULT_KEYS;
const rpc = get("--rpc");

const usdc = (wei) => `${Number(formatEther(wei)).toFixed(4)} USDC`;
const need = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

function deployment() {
  const file = join(ROOT, "lib", "deployments", "arc-mainnet.json");
  need(existsSync(file), "lib/deployments/arc-mainnet.json is missing: run `deploy` first");
  const d = JSON.parse(readFileSync(file, "utf8"));
  need(d.arclaw, "arc-mainnet.json has no arclaw address yet");
  return d;
}

/** How the deployer's remaining USDC is spread once the contracts are out (the float is what is left). */
export function fundPlan(spare) {
  const unit = parseEther("1");
  const fixed = { operator: 2n * unit, keeper: 3n * unit, guardian: unit / 3n, signer1: unit / 5n, signer2: unit / 5n, signer3: unit / 5n };
  const fixedTotal = Object.values(fixed).reduce((a, b) => a + b, 0n);
  // Plenty: the fixed amounts, the rest is float. Tight: the same shares, scaled down, 40 percent to the float.
  if (spare >= fixedTotal + 5n * unit) return { ...fixed, float: spare - fixedTotal };
  const share = { operator: 17n, keeper: 25n, guardian: 3n, signer1: 5n, signer2: 5n, signer3: 5n, float: 40n };
  return Object.fromEntries(Object.entries(share).map(([k, v]) => [k, (spare * v) / 100n]));
}

async function context() {
  const keys = readKeys(keysPath);
  const { publicClient, walletClient } = clients(rpc, keys.deployer.key);
  const chainId = await publicClient.getChainId();
  need(chainId === 5042, `Expected Arc mainnet (5042), got chain ${chainId}`);
  return { keys, publicClient, walletClient };
}

async function check() {
  const { keys, publicClient } = await context();
  const bal = await publicClient.getBalance({ address: keys.deployer.address });
  console.log(`deployer ${keys.deployer.address}: ${usdc(bal)}`);
  for (const r of ["operator", "keeper", "guardian", "signer1", "signer2", "signer3"]) console.log(`${r.padEnd(9)} ${keys[r].address}: ${usdc(await publicClient.getBalance({ address: keys[r].address }))}`);
  console.log(bal >= parseEther("1.5") ? "\nEnough to deploy." : "\nTOO LITTLE: the deployment needs about 1 USDC of gas (measured 0.3 to 0.9). Send at least 2 USDC to the deployer.");
  const plan = fundPlan(bal > parseEther("1.2") ? bal - parseEther("1.2") : 0n);
  console.log("\nAfter the deployment it would spread:", Object.entries(plan).map(([k, v]) => `${k} ${usdc(v)}`).join(", "));
}

async function deploy() {
  need(flag("--yes"), "Pass --yes to deploy for real.");
  const { keys, publicClient, walletClient } = await context();
  const bal = await publicClient.getBalance({ address: keys.deployer.address });
  need(bal >= parseEther("1.5"), `Deployer has ${usdc(bal)}; send at least 2 USDC first.`);
  const owners = ["signer1", "signer2", "signer3"].map((r) => keys[r].address);

  console.log("1/6 Safes");
  const ownerSafe = await createSafe({ publicClient, walletClient, owners, threshold: 2, saltNonce: saltOf("owner") });
  const treasurySafe = await createSafe({ publicClient, walletClient, owners, threshold: 2, saltNonce: saltOf("treasury") });
  console.log(`   owner Safe    ${ownerSafe.address}${ownerSafe.created ? "" : " (existing)"}\n   treasury Safe ${treasurySafe.address}${treasurySafe.created ? "" : " (existing)"}`);

  console.log("2/6 Contracts (forge script, paused, Single only)");
  const url = rpc ?? "https://rpc.mainnet.arc.io";
  // reserveFloor never above the float this deploy will actually send (audit 10a I-01): 5 USDC, or less on a tight budget
  const planned = fundPlan(bal > parseEther("1.2") ? bal - parseEther("1.2") : 0n).float;
  const asked = get("--reserve-floor");
  const floor = asked !== undefined ? parseEther(String(asked)) : planned < parseEther("5") ? planned : parseEther("5");
  if (floor > planned) console.log(`   warning: reserve floor ${usdc(floor)} is above the planned float ${usdc(planned)}; the keeper will report float-low until it is topped up`);
  const run = spawnSync(
    "forge",
    ["script", "script/Deploy.s.sol", "--tc", "Deploy", "--rpc-url", url, "--broadcast", "--with-gas-price", "30gwei", "--priority-gas-price", "1gwei", "--private-key", keys.deployer.key],
    {
      cwd: join(ROOT, "contracts"),
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        OWNER: ownerSafe.address,
        OPERATOR: keys.operator.address,
        KEEPER: keys.keeper.address,
        GUARDIAN: keys.guardian.address,
        RESERVE_FLOOR: floor.toString(),
        LAUNCH_MACHINES: "1",
        STRICT_OWNER: "1",
      },
    },
  );
  need(run.status === 0, "forge script failed (see the output above). Nothing was funded or handed over.");
  const d = deployment();
  console.log(`   arclaw ${d.arclaw}\n   vault  ${d.luckVault}\n   prices ${d.priceSource}\n   links  ${d.links}`);

  console.log("3/6 Ownership: the Owner Safe accepts (two signatures each)");
  for (const [name, address] of [["Arclaw", d.arclaw], ["price source", d.priceSource], ["luck vault", d.luckVault]]) {
    const pending = await publicClient.readContract({ address, abi: ownableAbi, functionName: "pendingOwner" });
    const owner = await publicClient.readContract({ address, abi: ownableAbi, functionName: "owner" });
    if (owner.toLowerCase() === ownerSafe.address.toLowerCase()) {
      console.log(`   ${name}: already owned by the Safe`);
      continue;
    }
    need(pending.toLowerCase() === ownerSafe.address.toLowerCase(), `${name}: the Safe is not the pending owner`);
    const r = await execSafeTx({ publicClient, walletClient, safe: ownerSafe.address, signerKeys: [keys.signer1.key, keys.signer2.key], to: address, data: encodeFunctionData({ abi: ownableAbi, functionName: "acceptOwnership" }) });
    console.log(`   ${name}: accepted ${r.hash}`);
  }

  console.log("4/6 Funding the other wallets and the float");
  const left = await publicClient.getBalance({ address: keys.deployer.address });
  const spare = left > parseEther("0.2") ? left - parseEther("0.2") : 0n;
  const plan = fundPlan(spare);
  const sent = [];
  for (const [who, amount] of Object.entries(plan)) {
    if (amount <= 0n) continue;
    const to = who === "float" ? d.arclaw : keys[who].address;
    const hash = await walletClient.sendTransaction({ to, value: amount, ...FEES });
    await publicClient.waitForTransactionReceipt({ hash });
    sent.push(`${who}: ${usdc(amount)}  ${hash}`);
    console.log(`   ${who.padEnd(9)} ${usdc(amount)}`);
  }

  console.log("5/6 Recording");
  appendLog(keysPath, "MAINNET DEPLOYMENT (paused, Single only)", [
    `arclaw:       ${d.arclaw}`,
    `price source: ${d.priceSource}`,
    `luck vault:   ${d.luckVault}`,
    `links:        ${d.links}`,
    `lens:         ${d.lens}`,
    `owner Safe:   ${ownerSafe.address}`,
    `treasury Safe:${treasurySafe.address}`,
    `deploy block: ${d.deployBlock}`,
    `explorer:     ${explorer("address", d.arclaw)}`,
    "funded:",
    ...sent.map((s) => `  ${s}`),
  ]);

  console.log("6/6 Done. The contract is PAUSED. Next: wire Convex and Vercel (docs/DEPLOY.md), run the keeper, then `unpause`.");
}

async function status() {
  const { keys, publicClient } = await context();
  const d = deployment();
  const read = (functionName, a = []) => publicClient.readContract({ address: d.arclaw, abi: arclawAbi, functionName, args: a });
  const [paused, guardian, operator, floor, bal] = await Promise.all([read("paused"), read("guardian"), read("operator"), read("reserveFloor"), publicClient.getBalance({ address: d.arclaw })]);
  console.log(JSON.stringify({ arclaw: d.arclaw, paused, balance: usdc(bal), reserveFloor: usdc(floor), guardianOk: guardian.toLowerCase() === keys.guardian.address.toLowerCase(), operatorOk: operator.toLowerCase() === keys.operator.address.toLowerCase(), machines: { single: !(await read("machineOff", [1n])), stack: !(await read("machineOff", [2n])), vault: !(await read("machineOff", [3n])) } }, null, 2));
}

async function ownerCall(functionName, a, what) {
  need(flag("--yes"), "Pass --yes to run it for real.");
  const { keys, publicClient, walletClient } = await context();
  const d = deployment();
  const ownerSafe = (await import("./safe.mjs")).predictSafe;
  const owners = ["signer1", "signer2", "signer3"].map((r) => keys[r].address);
  const safe = await ownerSafe(publicClient, owners, 2, saltOf("owner"));
  const r = await execSafeTx({ publicClient, walletClient, safe, signerKeys: [keys.signer1.key, keys.signer2.key], to: d.arclaw, data: encodeFunctionData({ abi: arclawAbi, functionName, args: a }) });
  console.log(`${what}: ${r.hash}`);
  appendLog(keysPath, what.toUpperCase(), [`tx: ${r.hash}`]);
}

async function main() {
  if (cmd === "check") return check();
  if (cmd === "deploy") return deploy();
  if (cmd === "status") return status();
  if (cmd === "unpause") return ownerCall("unpause", [], "unpaused");
  if (cmd === "enable") return ownerCall("setMachineActive", [BigInt(get("--machine")), true], `machine ${get("--machine")} enabled`);
  console.log("usage: deploy.mjs check|deploy|status|unpause|enable (see the header of this file)");
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exitCode = 1;
});
