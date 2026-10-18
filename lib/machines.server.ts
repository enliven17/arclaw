/**
 * Server only: merges lib/machines.resolved.json (exact cards per tier, written by the deploy tooling) into the
 * machines when the file exists. The file is optional and its shape is checked loosely; anything that does not
 * parse is ignored and the examples from lib/machines.ts stay.
 *
 * Accepted shape: { machines: [{ id, tiers: [{ name, cards: [{ ticker | symbol, valueUsdc | amountUsdc | usdc }] }] }] }
 */
import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ARC } from "./arc/config";
import { MACHINES, type Machine } from "./machines";
import { stockOf, type PullCard } from "./stocks";

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === "object" && v !== null;

function cardOf(c: unknown): PullCard | null {
  if (!isObj(c)) return null;
  const ticker = String(c.ticker ?? c.symbol ?? "").toUpperCase().replace(/\.ARC$/, "");
  // USDC value only: `amount` in the resolved file is raw token units, not dollars.
  const amount = Number(c.valueUsdc ?? c.amountUsdc ?? c.usdc);
  if (!/^[A-Z]{1,6}$/.test(ticker) || !Number.isFinite(amount) || amount < 0) return null;
  return { ticker, name: stockOf(ticker).name, amount: Math.round(amount * 100) / 100 };
}

export function withResolved(): Machine[] {
  const file = join(process.cwd(), ARC.network === "mainnet" ? "lib/machines.resolved.mainnet.json" : "lib/machines.resolved.json");
  if (!existsSync(file)) return [...MACHINES];
  try {
    const json: unknown = JSON.parse(readFileSync(file, "utf8"));
    const list = isObj(json) && Array.isArray(json.machines) ? json.machines : [];
    return MACHINES.map((m) => {
      const r = list.find((x): x is Loose => isObj(x) && Number(x.id) === m.id);
      const tiers = r && Array.isArray(r.tiers) ? r.tiers : [];
      return {
        ...m,
        tiers: m.tiers.map((t) => {
          const rt = tiers.find((x): x is Loose => isObj(x) && x.name === t.name);
          const cards = rt && Array.isArray(rt.cards) ? rt.cards.map(cardOf).filter((c): c is PullCard => c !== null) : [];
          return cards.length === 3 ? { ...t, cards } : t;
        }),
      };
    });
  } catch {
    return [...MACHINES];
  }
}
