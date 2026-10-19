/** Wallet error wording. Run: npx tsx --tsconfig tsconfig.json --test lib/arclaw/errors.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { UserRejectedRequestError, TransactionExecutionError, BaseError } from "viem";
import { revertText, userRejected } from "./contract";

test("a declined wallet prompt reads as a calm no, in every shape wallets send it", () => {
  const viemShape = new TransactionExecutionError(new UserRejectedRequestError(new Error("MetaMask Tx Signature: User denied transaction signature.")), { account: undefined } as never);
  const raw = Object.assign(new Error("User rejected the request."), { code: 4001 });
  const wc = new Error("Request rejected by user");
  for (const e of [viemShape, raw, wc]) {
    assert.equal(userRejected(e), true);
    assert.match(revertText(e), /declined in your wallet, so nothing was sent/);
  }
});

test("other errors keep one clean line, never the request or a URL", () => {
  const rpc = new BaseError("HTTP request failed.", { details: "URL: https://rpc.example/v2/key\nRequest body: {}" });
  assert.equal(userRejected(rpc), false);
  assert.equal(revertText(rpc), "HTTP request failed.");
  assert.match(revertText(new Error("insufficient funds for gas * price + value")), /not have enough USDC/);
  assert.match(revertText(new Error("execution reverted: TableChanged()")), /prizes for this machine were just updated/);
});
