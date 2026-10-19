/** The admin wallet and the sign-in message it signs (checked in lib/admin.server.ts, signed in components/app/AdminPanel.tsx). */
import { getAddress } from "viem";

export const ADMIN = getAddress("0xcc78505FE8707a1D85229BA0E7177aE26cE0f17D");

export const adminMessage = (domain: string, expires: number) =>
  ["arclaw admin sign-in", `domain: ${domain}`, `expires: ${new Date(expires).toISOString()}`, "Read only. This signature moves no funds."].join("\n");
