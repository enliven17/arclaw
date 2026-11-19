/** Display snapshots. Devnet stock tokens have no market; these prices only illustrate share amounts. */
import "server-only";
import { STOCKS } from "./stocks";

export type Quote = { price: number; changePct: number | null; live: boolean };

export async function getQuotes(): Promise<Record<string, Quote>> {
  return Object.fromEntries(STOCKS.map((s) => [s.ticker, { price: s.price, changePct: null, live: false }]));
}
