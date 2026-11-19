import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { configPda, IX, programId, treasuryAta, usdcMint } from "../../lib/solana/program";

export function loadWallets(data: unknown): Keypair[] {
  if (!Array.isArray(data) || data.length === 0) throw new Error("Expected a nonempty array of secret-key arrays.");
  const wallets = data.map((secret: unknown) => {
    if (!Array.isArray(secret) || secret.length !== 64 || secret.some((b: unknown) => !Number.isInteger(b) || Number(b) < 0 || Number(b) > 255))
      throw new Error("Invalid wallet secret-key format.");
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  });
  if (new Set(wallets.map((w) => w.publicKey.toBase58())).size !== wallets.length) throw new Error("Duplicate wallets in the input file.");
  return wallets;
}

/** Fixed snapshot price, rounded DOWN to whole micro-USDC; never floating point token math. */
export function quoteStock(amount: bigint, decimals: number, priceMicroUsdc: bigint): bigint {
  if (amount < 0n || priceMicroUsdc < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("Invalid stock quote.");
  return amount * priceMicroUsdc / (10n ** BigInt(decimals));
}

/** Existing admin instruction. The on-chain program enforces sealed/owed reserve protection. */
export function withdrawIx(admin: PublicKey, destination: PublicKey, amount: bigint): TransactionInstruction {
  if (amount <= 0n || amount > 0xffffffffffffffffn) throw new Error("Invalid withdrawal amount.");
  const data = Buffer.alloc(16);
  data.set(IX.withdraw);
  data.writeBigUInt64LE(amount, 8);
  return new TransactionInstruction({ programId: programId(), data, keys: [
    { pubkey: admin, isSigner: true, isWritable: false },
    { pubkey: configPda(), isSigner: false, isWritable: false },
    { pubkey: usdcMint(), isSigner: false, isWritable: false },
    { pubkey: treasuryAta(), isSigner: false, isWritable: true },
    { pubkey: destination, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ] });
}
