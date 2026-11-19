/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS compatibility for the SPL token dependency. */
const { Buffer } = require("buffer");

function toBigIntLE(bytes) {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}

function toBigIntBE(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function toBufferLE(value, width) {
  if (typeof value !== "bigint" || value < 0n) throw new RangeError("Expected an unsigned bigint.");
  if (!Number.isSafeInteger(width) || width < 0) throw new RangeError("Expected a non-negative integer width.");
  const bytes = Buffer.alloc(width);
  let left = value;
  for (let i = 0; i < width; i++) {
    bytes[i] = Number(left & 255n);
    left >>= 8n;
  }
  if (left !== 0n) throw new RangeError("Bigint does not fit the requested width.");
  return bytes;
}

function toBufferBE(value, width) {
  return toBufferLE(value, width).reverse();
}

module.exports = { toBigIntLE, toBigIntBE, toBufferLE, toBufferBE };
