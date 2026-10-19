/**
 * The US equity session (NYSE regular hours, 09:30 to 16:00 America/New_York, weekdays, minus full-day holidays),
 * computed from a unix timestamp so it follows the chain clock. Early closes count as open until 16:00: harmless,
 * the oracle's own staleness guard is what actually stops pricing.
 */

/** NYSE full-day closures. Extend every year (docs/OPERATIONS.md). */
export const NYSE_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

export type MarketClock = {
  open: boolean;
  /** Today's 09:30 ET as unix seconds when today is a trading day and the bell has rung, else null. */
  openedAt: number | null;
  /** New York date, YYYY-MM-DD. */
  day: string;
  tradingDay: boolean;
};

export function usMarket(ts: number, override: "auto" | "open" | "closed" = "auto"): MarketClock {
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ts * 1000)).map((p) => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const secs = mins * 60 + Number(parts.second);
  const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  const tradingDay = !weekend && !NYSE_HOLIDAYS.has(day);
  const afterBell = tradingDay && mins >= OPEN_MIN;
  const open = tradingDay && mins >= OPEN_MIN && mins < CLOSE_MIN;
  const openedAt = afterBell ? ts - (secs - OPEN_MIN * 60) : null;
  // forced open (tests, a holiday the list does not know): the bell is today's 09:30 ET whatever the weekday
  if (override === "open") return { open: true, openedAt: mins >= OPEN_MIN ? ts - (secs - OPEN_MIN * 60) : null, day, tradingDay: true };
  if (override === "closed") return { open: false, openedAt: null, day, tradingDay: false };
  return { open, openedAt, day, tradingDay };
}
