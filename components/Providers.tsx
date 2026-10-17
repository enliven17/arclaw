"use client";

/**
 * App-wide client providers. Today: smooth scroll. Wallets (wagmi + Circle passkey) and Convex mount here once
 * the app needs them; the packages are installed but nothing connects yet.
 */
import type { ReactNode } from "react";
import { SmoothScroll } from "./motion/SmoothScroll";
import { Splash } from "./motion/Splash";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SmoothScroll>
      <Splash />
      {children}
    </SmoothScroll>
  );
}
