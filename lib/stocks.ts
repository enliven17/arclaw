/**
 * Display data for the landing and share cards. The prize list itself comes from the contract and the Astock
 * token list (pandock/web/src/config.ts); nothing here decides what a box holds.
 */
export type Stock = { ticker: string; name: string };

export const STOCKS: readonly Stock[] = [
  { ticker: "NVDA", name: "NVIDIA" },
  { ticker: "AAPL", name: "Apple" },
  { ticker: "TSLA", name: "Tesla" },
  { ticker: "AMZN", name: "Amazon" },
  { ticker: "META", name: "Meta Platforms" },
  { ticker: "GOOGL", name: "Alphabet" },
  { ticker: "MSFT", name: "Microsoft" },
  { ticker: "AMD", name: "Advanced Micro Devices" },
  { ticker: "SPY", name: "S&P 500 ETF" },
  { ticker: "QQQ", name: "Nasdaq 100 ETF" },
  { ticker: "NFLX", name: "Netflix" },
  { ticker: "COIN", name: "Coinbase" },
  { ticker: "PLTR", name: "Palantir" },
  { ticker: "AVGO", name: "Broadcom" },
] as const;

const BY_TICKER = new Map(STOCKS.map((s) => [s.ticker, s]));

export const stockOf = (ticker: string): Stock => BY_TICKER.get(ticker.toUpperCase()) ?? { ticker: ticker.toUpperCase(), name: "Tokenized stock" };

/** One card of a pack: a stock and the USDC value it pays. */
export type PullCard = { ticker: string; name: string; amount: number };

/** The sample pack the landing opens. Sums to 0.75 USDC: inside the 70 to 80% band. */
export const SAMPLE_PACK: readonly PullCard[] = [
  { ticker: "NVDA", name: "NVIDIA", amount: 0.1 },
  { ticker: "AAPL", name: "Apple", amount: 0.4 },
  { ticker: "TSLA", name: "Tesla", amount: 0.25 },
];

/** "0.10" style: money is always two decimals, mono, tabular. */
export const usdc = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
