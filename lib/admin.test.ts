/** Admin sign-in checks. Run: npx tsx --conditions react-server --test lib/admin.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ADMIN_SESSION_MS, adminMessage } from "./admin";
import { allowedHost, isAdmin } from "./admin.server";

const admin = privateKeyToAccount(generatePrivateKey());
const host = "www.arclaw.app";
const signIn = async (expires: number, who = admin) => {
  const message = adminMessage(host, expires);
  return { message, signature: await who.signMessage({ message }) };
};

test("a browser clock a minute ahead still signs in", async () => {
  const now = 1_800_000_000_000;
  const s = await signIn(now + 60_000 + ADMIN_SESSION_MS);
  assert.equal(await isAdmin(host, s.message, s.signature, now, admin.address), true);
});

test("expired, far-future, wrong host and wrong signer are refused", async () => {
  const now = 1_800_000_000_000;
  const ok = await signIn(now + ADMIN_SESSION_MS);
  assert.equal(await isAdmin(host, ok.message, ok.signature, now + ADMIN_SESSION_MS + 1, admin.address), false);
  const far = await signIn(now + 60 * 60_000);
  assert.equal(await isAdmin(host, far.message, far.signature, now, admin.address), false);
  assert.equal(await isAdmin("evil.example", ok.message, ok.signature, now, admin.address), false);
  const other = await signIn(now + ADMIN_SESSION_MS, privateKeyToAccount(generatePrivateKey()));
  assert.equal(await isAdmin(host, other.message, other.signature, now, admin.address), false);
});

test("only the site's own hosts may be named in a sign-in", () => {
  assert.equal(allowedHost("www.arclaw.app", "https://arclaw.app"), true);
  assert.equal(allowedHost("arclaw.app", "https://www.arclaw.app"), true);
  assert.equal(allowedHost("localhost:3000", "https://arclaw.app"), true);
  assert.equal(allowedHost("evil.example", "https://arclaw.app"), false);
  assert.equal(allowedHost("arclaw.app.evil.example", "https://arclaw.app"), false);
});

test("the per-IP limit lets a minute's budget through, then refuses until the next minute", async () => {
  const { allow } = await import("./rate-limit.server");
  const t = 1_900_000_000_000;
  for (let i = 0; i < 20; i++) assert.equal(allow("t:1.2.3.4", 20, t + i), true);
  assert.equal(allow("t:1.2.3.4", 20, t + 30), false);
  assert.equal(allow("t:5.6.7.8", 20, t + 30), true, "another IP has its own budget");
  assert.equal(allow("t:1.2.3.4", 20, t + 60_000), true, "a new minute");
});
