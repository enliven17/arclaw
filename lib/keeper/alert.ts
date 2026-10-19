/**
 * Alerts: the active issues of a tick, deduplicated against what was already sent, to Telegram (TELEGRAM_BOT_TOKEN to
 * ALERT_TELEGRAM_CHAT_ID) and to the event log. An issue is sent when it first appears, when its severity rises, and
 * again every REPEAT_S while it lasts; a "resolved" line goes out once it has been gone for RESOLVE_QUIET_S, so an issue
 * that flaps (an RPC that fails every few ticks) is one alert, not an alert and a resolve every few minutes. Info
 * issues are logged only.
 * Plain text (no parse mode), so nothing in a message can inject markup. KEEPER_TELEGRAM_API overrides the Bot API
 * origin (tests point it at a local fake).
 */
import type { KeeperConfig } from "./config";
import type { Issue, KeeperEvent, KeeperState, Severity } from "./store";

const RANK: Record<Severity, number> = { info: 0, warn: 1, critical: 2 };
export const REPEAT_S: Record<Severity, number> = { info: Infinity, warn: 6 * 3600, critical: 3600 };
export const RESOLVE_QUIET_S = 15 * 60;

export type Notify = (text: string) => Promise<void>;

export function telegramNotify(chatId: string, token = process.env.TELEGRAM_BOT_TOKEN, api = process.env.KEEPER_TELEGRAM_API || "https://api.telegram.org"): Notify {
  return async (text) => {
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");
    const res = await fetch(`${api}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(10_000),
    });
    // never echo the URL: it carries the bot token
    if (!res.ok) throw new Error(`telegram sendMessage failed: ${res.status}`);
  };
}

export const notifierOf = (cfg: KeeperConfig): Notify | null => (cfg.telegram ? telegramNotify(cfg.telegram.chatId) : null);

const label = (cfg: KeeperConfig) => `arclaw keeper ${cfg.network}`;

/**
 * Updates state.alerts in place and returns the events to log. `now` is wall-clock seconds. A failed send leaves the
 * record unsent so the next tick tries again.
 */
export async function reconcileAlerts(cfg: KeeperConfig, state: KeeperState, issues: readonly Issue[], now: number, notify: Notify | null): Promise<KeeperEvent[]> {
  const events: KeeperEvent[] = [];
  const active = new Map<string, Issue>();
  for (const i of issues) {
    const prev = active.get(i.key);
    if (!prev || RANK[i.severity] > RANK[prev.severity]) active.set(i.key, i);
  }
  const send = async (text: string): Promise<boolean> => {
    if (!notify) return true;
    try {
      await notify(text);
      return true;
    } catch (e) {
      events.push({ at: now, kind: "alert-failed", level: "warn", message: (e as Error).message });
      return false;
    }
  };

  for (const issue of active.values()) {
    if (issue.severity === "info") continue;
    const rec = state.alerts[issue.key];
    const due = !rec || RANK[issue.severity] > RANK[rec.severity] || now - rec.lastSentAt >= REPEAT_S[issue.severity];
    if (!due) {
      state.alerts[issue.key] = { ...rec, lastSeenAt: now };
      continue;
    }
    const text = `${issue.severity === "critical" ? "CRITICAL" : "WARN"} ${label(cfg)}\n${issue.key}: ${issue.message}`;
    const sent = await send(text);
    events.push({ at: now, kind: "alert", level: issue.severity === "critical" ? "error" : "warn", message: `${issue.key}: ${issue.message}`, data: { sent, severity: issue.severity } });
    state.alerts[issue.key] = { severity: issue.severity, message: issue.message, firstAt: rec?.firstAt ?? now, lastSentAt: sent ? now : (rec?.lastSentAt ?? 0), lastSeenAt: now };
  }
  for (const [key, rec] of Object.entries(state.alerts)) {
    const now_ = active.get(key);
    if (now_ && now_.severity !== "info") continue;
    if (now - (rec.lastSeenAt ?? rec.lastSentAt) < RESOLVE_QUIET_S) continue;
    const sent = await send(`RESOLVED ${label(cfg)}\n${key}: ${rec.message}`);
    events.push({ at: now, kind: "alert-resolved", level: "info", message: `${key} resolved`, data: { sent } });
    if (sent) delete state.alerts[key];
  }
  return events;
}
