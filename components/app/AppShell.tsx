"use client";

/**
 * The app's frame: a compact fixed header (logo, nav, sound, wallet), the connect sheet, and a quiet footer with
 * the legal links. Wallets (Privy) live here, so the marketing pages never load them.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { SoundToggle } from "@/components/SoundToggle";
import { AgeGate } from "@/components/app/AgeGate";
import { WalletButton } from "@/components/wallet/WalletButton";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import { ARC } from "@/lib/arc/config";
import { X_URL } from "@/lib/seo";
import { cn } from "@/lib/cn";
import { ClawLink } from "@/components/motion/PageTransitions";

const NAV = [
  { href: "/app/play", label: "Play" },
  { href: "/app/collection", label: "Collection" },
  { href: "/app/gifts", label: "Gifts" },
  { href: "/app/leaderboard", label: "Leaderboard" },
];

function Header() {
  const path = usePathname();
  return (
    <header className="fixed inset-x-0 top-0 z-[90] border-b border-line bg-ink/85 backdrop-blur-md">
      <div className="wrap flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <ClawLink href="/" aria-label="arclaw home" className="rounded-[4px]">
            <Logo height={22} />
          </ClawLink>
          <nav aria-label="App" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {NAV.map((n) => {
                const on = path === n.href || path.startsWith(`${n.href}/`);
                return (
                  <li key={n.href}>
                    <Link href={n.href} aria-current={on ? "page" : undefined} className={cn("rounded-[10px] px-3 py-2 text-[14px] transition-colors", on ? "text-cream" : "text-muted hover:text-cream")}>
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {ARC.network === "testnet" ? <span className="hidden text-[13px] text-muted sm:inline">Testnet</span> : null}
          <SoundToggle />
          <WalletButton />
        </div>
      </div>
      {/* Phones: the nav as a row under the bar. */}
      <nav aria-label="App" className="border-t border-line md:hidden">
        <ul className="wrap grid grid-cols-4">
          {NAV.map((n) => {
            const on = path === n.href || path.startsWith(`${n.href}/`);
            return (
              <li key={n.href}>
                <Link href={n.href} aria-current={on ? "page" : undefined} className={cn("block py-2.5 text-center text-[13px]", on ? "text-cream" : "text-muted")}>
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="wrap flex flex-col gap-4 py-8 text-[13px] text-muted md:flex-row md:items-center md:justify-between">
        <p>Prizes are tokenized stocks and can lose value. For players 18 and over.</p>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          <li>
            <a className="hover:text-cream" href="/disclaimer">
              Risk disclaimer
            </a>
          </li>
          <li>
            <a className="hover:text-cream" href="/privacy">
              Privacy
            </a>
          </li>
          <li>
            <a className="hover:text-cream" href={X_URL} rel="noopener noreferrer" target="_blank">
              X
            </a>
          </li>
          <li>
            <a className="hover:text-cream" href={ARC.chain.explorer} rel="noopener noreferrer" target="_blank">
              Explorer
            </a>
          </li>
        </ul>
      </div>
    </footer>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <AgeGate />
      <Header />
      <main id="main" className="app-enter min-h-dvh pt-[96px] md:pt-14">
        {children}
      </main>
      <Footer />
    </WalletProvider>
  );
}
