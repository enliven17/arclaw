"use client";

/** A small note on a marketplace card when its machine cannot take plays yet or the contract is paused. */
import { useMachineStatus } from "./useMachineStatus";

export function MachineBadge({ machineId }: { machineId: number }) {
  const state = useMachineStatus(machineId, { wake: false, poll: false });
  if (state !== "off" && state !== "paused") return null;
  return (
    <span className="rounded-[8px] border border-line-strong px-2 py-1 text-[13px] text-muted">{state === "off" ? "Opens soon" : "Paused"}</span>
  );
}
