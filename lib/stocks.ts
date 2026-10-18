/**
 * Display data for the landing and share cards: the Astock v2 list (astock.fi/api/v2/stocks), with a price
 * snapshot taken 2026-10-17 as the fallback when live quotes are unavailable. Nothing here decides what a box
 * holds; the contract and lib/machines.json do.
 */
export type Stock = { ticker: string; name: string; kind: "stock" | "etf"; price: number };

export const STOCKS: readonly Stock[] = [
  { ticker: "NVDA", name: "NVIDIA", kind: "stock", price: 214.18 },
  { ticker: "TSLA", name: "Tesla", kind: "stock", price: 353.10 },
  { ticker: "AAPL", name: "Apple", kind: "stock", price: 343.21 },
  { ticker: "AMZN", name: "Amazon", kind: "stock", price: 250.19 },
  { ticker: "META", name: "Meta Platforms", kind: "stock", price: 710.51 },
  { ticker: "GOOGL", name: "Alphabet", kind: "stock", price: 338.75 },
  { ticker: "SPY", name: "S&P 500 ETF", kind: "etf", price: 763.67 },
  { ticker: "QQQ", name: "Nasdaq 100 ETF", kind: "etf", price: 710.14 },
  { ticker: "SGOV", name: "Short Treasury ETF", kind: "etf", price: 101.34 },
  { ticker: "CRCL", name: "Circle Internet", kind: "stock", price: 82.20 },
  { ticker: "USO", name: "Oil ETF", kind: "etf", price: 162.18 },
  { ticker: "SPCX", name: "SpaceX", kind: "stock", price: 145.33 },
  { ticker: "GLD", name: "Gold ETF", kind: "etf", price: 383.12 },
  { ticker: "GME", name: "GameStop", kind: "stock", price: 27.37 },
  { ticker: "MU", name: "Micron Technology", kind: "stock", price: 876.23 },
  { ticker: "RDDT", name: "Reddit", kind: "stock", price: 156.53 },
  { ticker: "HIMS", name: "Hims & Hers Health", kind: "stock", price: 28.26 },
  { ticker: "MSTR", name: "Strategy", kind: "stock", price: 137.43 },
  { ticker: "MSFT", name: "Microsoft", kind: "stock", price: 530.34 },
  { ticker: "AMC", name: "AMC Entertainment", kind: "stock", price: 2.89 },
  { ticker: "COST", name: "Costco", kind: "stock", price: 988.91 },
  { ticker: "LLY", name: "Eli Lilly", kind: "stock", price: 1257.68 },
  { ticker: "INTC", name: "Intel", kind: "stock", price: 89.59 },
  { ticker: "DJT", name: "Trump Media", kind: "stock", price: 7.06 },
  { ticker: "DELL", name: "Dell", kind: "stock", price: 456.09 },
  { ticker: "AMD", name: "AMD", kind: "stock", price: 530.77 },
  { ticker: "RBLX", name: "Roblox", kind: "stock", price: 50.15 },
  { ticker: "SLV", name: "Silver ETF", kind: "etf", price: 51.70 },
  { ticker: "AVGO", name: "Broadcom", kind: "stock", price: 332.21 },
];

const BY_TICKER = new Map(STOCKS.map((s) => [s.ticker, s]));

export const stockOf = (ticker: string): Stock =>
  BY_TICKER.get(ticker.toUpperCase()) ?? { ticker: ticker.toUpperCase(), name: "Tokenized stock", kind: "stock", price: 0 };

/** Local logo path (public/logos, written by scripts/assets/logos.mjs). */
export const logoOf = (ticker: string) => (BY_TICKER.has(ticker.toUpperCase()) ? `/logos/${ticker.toUpperCase()}.svg` : null);

/** One card of a pack: a stock and the USDC value it pays. */
export type PullCard = { ticker: string; name: string; amount: number };

/** "0.10" style: money is always two decimals, mono, tabular. */
export const usdc = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
