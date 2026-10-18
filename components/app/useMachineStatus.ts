"use client";

/**
 * The state of one machine (lib/arclaw/status.ts), polled while the tab is visible. When the prize table is stale it asks
 * the keeper to reprice (POST /api/wake, at most once a minute per machine) and keeps polling until the table is fresh, so
 * a visitor to an idle machine waits a few seconds instead of hitting an error.
 */
import { useEffect, useState } from "react";
import { arcClient } from "@/lib/arc/chain";
import { readMachineStatuses, type MachineState } from "@/lib/arclaw/status";

const POLL_MS = 15_000;
const WAKE_EVERY_MS = 60_000;
const lastWake = new Map<number, number>();

export function useMachineStatus(machineId: number, { wake = true, poll = true }: { wake?: boolean; poll?: boolean } = {}): MachineState {
  const [state, setState] = useState<MachineState>("unknown");

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const tick = async () => {
      if (!live) return;
      const s = (await readMachineStatuses(arcClient(), [machineId]))[machineId]?.state ?? "unknown";
      if (!live) return;
      setState(s);
      if (s === "stale" && wake && Date.now() - (lastWake.get(machineId) ?? 0) > WAKE_EVERY_MS) {
        lastWake.set(machineId, Date.now());
        void fetch("/api/wake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ machineId }) }).catch(() => undefined);
      }
      // A stale machine is being repriced: look again soon. Otherwise the slow poll, and none while the tab is hidden.
      const next = s === "stale" ? 4_000 : POLL_MS;
      if (poll || s === "stale") timer = window.setTimeout(() => void (document.hidden ? (timer = window.setTimeout(tick, POLL_MS)) : tick()), next);
    };
    void tick();
    return () => {
      live = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [machineId, wake, poll]);

  return state;
}
