"use client";

/**
 * The state of one machine (lib/solana/client.ts readMachineStatuses), polled while the tab is visible. A stale table
 * is repriced by the operator; the app polls faster until it is fresh again.
 */
import { useEffect, useState } from "react";
import { readMachineStatuses, type MachineState } from "@/lib/solana/client";

const POLL_MS = 15_000;

export function useMachineStatus(machineId: number, { poll = true }: { poll?: boolean } = {}): MachineState {
  const [state, setState] = useState<MachineState>("unknown");

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const tick = async () => {
      if (!live) return;
      const s = (await readMachineStatuses([machineId]))[machineId] ?? "unknown";
      if (!live) return;
      setState(s);
      const next = s === "stale" ? 4_000 : POLL_MS;
      if (poll || s === "stale") timer = window.setTimeout(() => void (document.hidden ? (timer = window.setTimeout(tick, POLL_MS)) : tick()), next);
    };
    void tick();
    return () => {
      live = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [machineId, poll]);

  return state;
}
