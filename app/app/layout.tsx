import type { Metadata } from "next";
import { connection } from "next/server";
import { AppShell } from "@/components/app/AppShell";

export const metadata: Metadata = {
  title: { default: "Play", template: "%s | arclaw" },
  description: "Choose an arclaw machine, play with USDC on Solana, and open sealed boxes into three tokenized stock cards.",
  robots: { index: true, follow: true },
};

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  // Per request, so Next can put proxy.ts's CSP nonce on its scripts (a prerendered page has no nonce to carry).
  await connection();
  return <AppShell>{children}</AppShell>;
}
