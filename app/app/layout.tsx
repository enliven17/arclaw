import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";

export const metadata: Metadata = {
  title: { default: "Play", template: "%s | arclaw" },
  description: "Choose an arclaw machine, play with USDC on Arc, and open sealed boxes into three tokenized stock cards.",
  robots: { index: true, follow: true },
};

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return <AppShell>{children}</AppShell>;
}
