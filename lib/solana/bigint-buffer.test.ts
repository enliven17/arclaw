import assert from "node:assert/strict";
import { test } from "node:test";
import { MintLayout } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { toBigIntLE, toBigIntBE, toBufferLE, toBufferBE } from "../../vendor/bigint-buffer";

test("SPL mint supply preserves the full unsigned 64-bit range without native code", () => {
  for (const supply of [0n, 1n, 2n ** 53n + 1n, 2n ** 64n - 1n]) {
    const bytes = Buffer.alloc(MintLayout.span);
    MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply, decimals: 8, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, bytes);
    assert.equal(MintLayout.decode(bytes).supply, supply);
  }
});

test("bigint conversion supports endian order, empty buffers and unsigned 128-bit values", () => {
  const value = (1n << 127n) + 0x123456n;
  const le = toBufferLE(value, 16);
  const be = toBufferBE(value, 16);
  assert.deepEqual([...le.slice(0, 3)], [0x56, 0x34, 0x12]);
  assert.equal(be[0], 0x80);
  assert.equal(toBigIntLE(le), value);
  assert.equal(toBigIntBE(be), value);
  assert.equal(toBigIntLE(new Uint8Array()), 0n);
  assert.throws(() => toBufferLE(-1n, 8), RangeError);
  assert.throws(() => toBufferLE(256n, 1), RangeError);
  assert.throws(() => toBufferLE(1n, -1), RangeError);
});
