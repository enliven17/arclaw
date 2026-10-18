/**
 * Whether a machine can take a play and an open right now, read from the contract: is it switched on, is the contract
 * paused, and is its prize table fresh. The keeper keeps tables fresh while a machine has demand (docs/OPERATIONS.md),
 * and lets an idle one go stale to save gas, so "stale" is a normal state the app handles by waking it.
 *
 *   ready    play and open work
 *   stale    the table has aged out (or is about to): the keeper is asked to reprice, Play waits
 *   off      the machine is switched off or has no prizes yet
 *   paused   the whole contract is paused
 *   unknown  the chain could not be read (treated as ready by the UI: the contract is the judge)
 */
import type { PublicClient } from "viem";
import { arclawAbi } from "@/lib/abi";
import { ARCLAW, withRetry } from "./contract";

export type MachineState = "ready" | "stale" | "off" | "paused" | "unknown";
export type MachineStatus = { state: MachineState };

/** Opens refuse a table at maxTableAge; treat it as stale a little earlier so a click never lands on the edge. */
const MARGIN_S = 15 * 60;

export async function readMachineStatuses(client: PublicClient, ids: readonly number[]): Promise<Record<number, MachineStatus>> {
  const address = ARCLAW;
  const out: Record<number, MachineStatus> = {};
  if (!address) {
    for (const id of ids) out[id] = { state: "unknown" };
    return out;
  }
  try {
    const read = <T,>(functionName: string, args: readonly unknown[] = []) =>
      withRetry(() => client.readContract({ address, abi: arclawAbi, functionName: functionName as never, args: args as never })) as Promise<T>;
    const [paused, maxAge, block] = await Promise.all([read<boolean>("paused"), read<bigint>("maxTableAge"), client.getBlock()]);
    for (const id of ids) {
      if (paused) {
        out[id] = { state: "paused" };
        continue;
      }
      const [off, tables] = await Promise.all([read<boolean>("machineOff", [BigInt(id)]), read<bigint>("currentTable", [BigInt(id)])]);
      if (off || tables === 0n) {
        out[id] = { state: "off" };
        continue;
      }
      const pricedAt = await read<bigint>("tablePricedAt", [tables - 1n]);
      out[id] = { state: block.timestamp + BigInt(MARGIN_S) >= pricedAt + maxAge ? "stale" : "ready" };
    }
  } catch {
    for (const id of ids) out[id] = { state: "unknown" };
  }
  return out;
}
