/**
 * Safe (v1.4.1) helpers for Arc, using the canonical Safe contracts that are already deployed there, with no Safe web
 * app needed (it does not list Arc): create a Safe, predict its address, and run a transaction signed by the owners
 * whose keys are in the bundle.
 *
 *   node scripts/mainnet/safe.mjs create --name owner|treasury [--keys <file>] [--rpc <url>] [--threshold 2]
 *   node scripts/mainnet/safe.mjs exec --safe 0x.. --to 0x.. [--data 0x..] [--value <wei>] [--signers signer1,signer2]
 *                                      [--keys <file>] [--rpc <url>]
 *   node scripts/mainnet/safe.mjs owners --safe 0x..
 *
 * `create` is deterministic per name (the salt is derived from it), so running it twice returns the same Safe.
 */
import { pathToFileURL } from "node:url";
import { encodeAbiParameters, encodeFunctionData, getContractAddress, keccak256, numberToHex, parseAbi, concat, stringToHex, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FEES, appendLog, args, clients, DEFAULT_KEYS, readKeys, explorer } from "./lib.mjs";

/** Canonical Safe v1.4.1 addresses (the same on every chain they are deployed to, Arc included). */
export const SAFE = {
  factory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  singletonL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
};

const factoryAbi = parseAbi([
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "function proxyCreationCode() view returns (bytes)",
]);
const safeAbi = parseAbi([
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
]);

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
};

export const saltOf = (name) => BigInt(keccak256(stringToHex(`arclaw:${name}:v1`)));

export function setupData(owners, threshold) {
  return encodeFunctionData({
    abi: safeAbi,
    functionName: "setup",
    args: [owners, BigInt(threshold), zeroAddress, "0x", SAFE.fallbackHandler, zeroAddress, 0n, zeroAddress],
  });
}

/** The address createProxyWithNonce will produce for these owners, threshold and salt. */
export async function predictSafe(publicClient, owners, threshold, saltNonce) {
  const creation = await publicClient.readContract({ address: SAFE.factory, abi: factoryAbi, functionName: "proxyCreationCode" });
  const initializer = setupData(owners, threshold);
  const salt = keccak256(concat([keccak256(initializer), numberToHex(saltNonce, { size: 32 })]));
  const deployment = concat([creation, encodeAbiParameters([{ type: "uint256" }], [BigInt(SAFE.singletonL2)])]);
  return getContractAddress({ opcode: "CREATE2", from: SAFE.factory, salt, bytecodeHash: keccak256(deployment) });
}

/** Creates the Safe (or returns the existing one at the predicted address). */
export async function createSafe({ publicClient, walletClient, owners, threshold, saltNonce }) {
  const address = await predictSafe(publicClient, owners, threshold, saltNonce);
  const code = await publicClient.getCode({ address });
  if (code && code !== "0x") return { address, created: false };
  const hash = await walletClient.writeContract({
    address: SAFE.factory,
    abi: factoryAbi,
    functionName: "createProxyWithNonce",
    args: [SAFE.singletonL2, setupData(owners, threshold), saltNonce],
    ...FEES,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Safe creation reverted: ${hash}`);
  const check = await publicClient.getCode({ address });
  if (!check || check === "0x") throw new Error(`Safe not found at the predicted address ${address}`);
  return { address, created: true, hash };
}

/** Signs and executes a Safe transaction. `signerKeys` are the owners' private keys (at least the threshold). */
export async function execSafeTx({ publicClient, walletClient, safe, signerKeys, to, value = 0n, data = "0x" }) {
  const nonce = await publicClient.readContract({ address: safe, abi: safeAbi, functionName: "nonce" });
  const threshold = await publicClient.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" });
  const owners = (await publicClient.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" })).map((a) => a.toLowerCase());
  const message = { to, value, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: zeroAddress, refundReceiver: zeroAddress, nonce };
  const accounts = signerKeys.map((k) => privateKeyToAccount(k));
  for (const a of accounts) if (!owners.includes(a.address.toLowerCase())) throw new Error(`${a.address} is not an owner of ${safe}`);
  if (accounts.length < Number(threshold)) throw new Error(`Need ${threshold} signatures, got ${accounts.length}`);
  const domain = { chainId: publicClient.chain.id, verifyingContract: safe };
  const signed = await Promise.all(
    accounts.slice(0, Number(threshold)).map(async (a) => ({
      owner: a.address.toLowerCase(),
      signature: await a.signTypedData({ domain, types: SAFE_TX_TYPES, primaryType: "SafeTx", message }),
    })),
  );
  // The Safe wants the signatures ordered by signer address, ascending.
  signed.sort((x, y) => (BigInt(x.owner) < BigInt(y.owner) ? -1 : 1));
  const signatures = concat(signed.map((s) => s.signature));
  const hash = await walletClient.writeContract({
    address: safe,
    abi: safeAbi,
    functionName: "execTransaction",
    args: [to, value, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signatures],
    ...FEES,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Safe transaction reverted: ${hash}`);
  return { hash };
}

export async function ownersOf(publicClient, safe) {
  const [owners, threshold] = await Promise.all([
    publicClient.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
    publicClient.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }),
  ]);
  return { owners, threshold: Number(threshold) };
}

async function main() {
  const { argv, get } = args();
  const cmd = argv[0];
  const keysPath = get("--keys") ?? DEFAULT_KEYS;
  const rpc = get("--rpc");
  if (cmd === "create") {
    const name = get("--name");
    if (!name) throw new Error("--name owner|treasury is required");
    const keys = readKeys(keysPath);
    const threshold = Number(get("--threshold") ?? 2);
    const owners = ["signer1", "signer2", "signer3"].map((r) => keys[r].address);
    const { publicClient, walletClient } = clients(rpc, keys.deployer.key);
    const r = await createSafe({ publicClient, walletClient, owners, threshold, saltNonce: saltOf(name) });
    console.log(`${name} Safe ${r.created ? "created" : "already exists"}: ${r.address}`);
    appendLog(keysPath, `${name.toUpperCase()} SAFE`, [`address: ${r.address}`, `owners: ${owners.join(", ")}`, `threshold: ${threshold}`, r.hash ? `tx: ${r.hash}` : "tx: (existing)", `explorer: ${explorer("address", r.address)}`]);
  } else if (cmd === "exec") {
    const keys = readKeys(keysPath);
    const names = (get("--signers") ?? "signer1,signer2").split(",");
    const { publicClient, walletClient } = clients(rpc, keys.deployer.key);
    const r = await execSafeTx({ publicClient, walletClient, safe: get("--safe"), signerKeys: names.map((n) => keys[n].key), to: get("--to"), value: BigInt(get("--value") ?? 0), data: get("--data") ?? "0x" });
    console.log(`executed: ${r.hash}`);
  } else if (cmd === "owners") {
    const { publicClient } = clients(rpc);
    console.log(JSON.stringify(await ownersOf(publicClient, get("--safe")), null, 2));
  } else {
    console.log("usage: safe.mjs create|exec|owners (see the header of this file)");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e.shortMessage ?? e.message ?? e);
    process.exit(1);
  });
}
