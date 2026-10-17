/**
 * The passkey wallet: a Circle Modular Wallet (ERC-4337 smart account, Circle's MSCA) owned by a passkey on the
 * user's device. Ported from mimir-solana/lib/arc/account.ts, trimmed to what arclaw needs: create, log in,
 * restore, and send calls. Gas is sponsored by Circle Gas Station (`paymaster: true`); value (the USDC a play
 * costs) comes from the account's own balance. Browser only (WebAuthn): load it through lib/arc/lazy.ts.
 *
 * Boxes are ERC-1155 and play() mints with the receiver check. Circle's MSCA implementation on Arc testnet
 * (0xA70F1296869DA9D7CB69578123F21888E6dB2B62, the factory's ACCOUNT_IMPLEMENTATION) returns 0xf23a6e61 from
 * onERC1155Received and supportsInterface(IERC1155Receiver) is true, so passkey accounts receive boxes.
 *
 * Persistence: only the passkey's public credential and the account address go to localStorage. The private key
 * never leaves the authenticator; every signature still needs the user's Face ID, fingerprint or PIN.
 */
import {
  getAddressMapping,
  getUserOperationGasPrice,
  OwnerIdentifierType,
  toCircleModularWalletClient,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  WebAuthnMode,
  type WebAuthnCredential,
} from "@circle-fin/modular-wallets-core";
import { bytesToHex, createPublicClient, getAddress, hexToBigInt, hexToBytes, parseGwei, type Address, type Hex, type PublicClient, type Transport } from "viem";
import { createBundlerClient, toWebAuthnAccount, type SmartAccount } from "viem/account-abstraction";
import { arcChain } from "./chain";
import { ARC, MIN_FEE_PER_GAS, type ArcConfig } from "./config";

export type Call = { to: Address; data: Hex; value?: bigint };

export type StoredPasskey = { id: string; publicKey: Hex; rpId?: string; address?: Address };

export type PasskeySession = {
  address: Address;
  passkey: StoredPasskey;
  /** One sponsored user operation with every call; resolves with the transaction hash once mined, throws if reverted. */
  sendCalls(calls: Call[]): Promise<Hex>;
};

const storageKey = (config: ArcConfig) => `arclaw:passkey:${config.network}`;

export function loadStoredPasskey(config: ArcConfig = ARC): StoredPasskey | null {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey(config)) ?? "null") as StoredPasskey | null;
    return v && typeof v.id === "string" && typeof v.publicKey === "string" ? v : null;
  } catch {
    return null;
  }
}

export function clearStoredPasskey(config: ArcConfig = ARC): void {
  localStorage.removeItem(storageKey(config));
}

function requireClientKey(config: ArcConfig): string {
  if (!config.circle.clientKey) throw new Error("Passkey wallets are not configured on this site.");
  return config.circle.clientKey;
}

const toStored = (c: WebAuthnCredential, address?: Address): StoredPasskey => ({ id: c.id, publicKey: c.publicKey, rpId: c.rpId, ...(address ? { address } : {}) });

function p256(publicKey: Hex): { x: bigint; y: bigint } {
  const b = hexToBytes(publicKey);
  const o = b.length === 65 ? 1 : 0;
  return { x: hexToBigInt(bytesToHex(b.slice(o, o + 32))), y: hexToBigInt(bytesToHex(b.slice(o + 32, o + 64))) };
}

/** Circle's Arc bundler refuses a tip under 1 gwei, and Arc drops a fee cap under 20 gwei. */
const MIN_TIP = parseGwei("1");
function fees(base: bigint, tip: bigint, headroom = 2n) {
  const t = tip > MIN_TIP ? tip : MIN_TIP;
  const cap = base * headroom + t;
  return { maxPriorityFeePerGas: t, maxFeePerGas: cap > MIN_FEE_PER_GAS ? cap : MIN_FEE_PER_GAS };
}

function bundlerFor(account: SmartAccount, config: ArcConfig, transport: Transport) {
  const client = createPublicClient({ chain: arcChain(config), transport }) as PublicClient;
  return createBundlerClient({
    account,
    chain: arcChain(config),
    transport,
    userOperation: {
      estimateFeesPerGas: async () => {
        try {
          const { low } = await getUserOperationGasPrice(client);
          return fees(BigInt(low.maxFeePerGas) - BigInt(low.maxPriorityFeePerGas), BigInt(low.maxPriorityFeePerGas), 1n);
        } catch {
          const block = await client.getBlock();
          return fees(block.baseFeePerGas ?? (await client.getGasPrice()), 0n);
        }
      },
    },
  });
}

/** The account a passkey owns: Circle's mapping first (recovered passkeys), else its own counterfactual account. */
async function accountAddress(passkey: StoredPasskey, config: ArcConfig): Promise<Address | undefined> {
  if (passkey.address) return passkey.address;
  try {
    const transport = toModularTransport(config.circle.modularUrl, requireClientKey(config));
    const client = toCircleModularWalletClient({ client: createPublicClient({ chain: arcChain(config), transport }) });
    const { x, y } = p256(passkey.publicKey);
    const mapping = await getAddressMapping(client, { owner: { type: OwnerIdentifierType.WebAuthn, identifier: { publicKeyX: x.toString(), publicKeyY: y.toString() } } });
    return mapping[0]?.walletAddress;
  } catch {
    return undefined;
  }
}

/** Rebuild the session from a stored public credential. No prompt until something is signed. */
export async function openSession(passkey: StoredPasskey, config: ArcConfig = ARC): Promise<PasskeySession> {
  const transport = toModularTransport(config.circle.modularUrl, requireClientKey(config));
  const client = createPublicClient({ chain: arcChain(config), transport });
  const owner = toWebAuthnAccount({ credential: { id: passkey.id, publicKey: passkey.publicKey }, rpId: passkey.rpId });
  const known = await accountAddress(passkey, config);
  const account = await toCircleSmartAccount({ client, owner, ...(known ? { address: known } : {}) });
  const bundler = bundlerFor(account, config, transport);
  const address = getAddress(account.address);
  const stored = { ...passkey, address };
  localStorage.setItem(storageKey(config), JSON.stringify(stored));
  return {
    address,
    passkey: stored,
    async sendCalls(calls) {
      if (!calls.length) throw new Error("Nothing to send.");
      const hash = await bundler.sendUserOperation({ calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value ?? 0n })), paymaster: true });
      const { receipt, success, reason } = await bundler.waitForUserOperationReceipt({ hash, timeout: 120_000 });
      if (!success || receipt.status !== "success") throw new Error(`The transaction reverted${reason ? `: ${reason}` : ""}.`);
      return receipt.transactionHash;
    },
  };
}

/** Create a passkey on this device (Face ID, fingerprint or PIN) and its account. */
export async function createPasskey(username: string, config: ArcConfig = ARC): Promise<PasskeySession> {
  const credential = await toWebAuthnCredential({ transport: toPasskeyTransport(config.circle.passkeyUrl, requireClientKey(config)), mode: WebAuthnMode.Register, username });
  return openSession(toStored(credential), config);
}

/** Use a passkey this device (or a synced keychain) already has. */
export async function loginPasskey(config: ArcConfig = ARC): Promise<PasskeySession> {
  const credential = await toWebAuthnCredential({ transport: toPasskeyTransport(config.circle.passkeyUrl, requireClientKey(config)), mode: WebAuthnMode.Login });
  return openSession(toStored(credential), config);
}
