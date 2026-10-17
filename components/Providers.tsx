"use client";

/**
 * App-wide client providers. Today: smooth scroll. Wallets (wagmi + Circle passkey) and Convex mount here once
 * the app needs them; the packages are installed but nothing connects yet.
 */
import { useEffect, type ReactNode } from "react";
import { armSound } from "@/lib/sfx";
import { SmoothScroll } from "./motion/SmoothScroll";
import { Cursor } from "./motion/Cursor";
import { Splash } from "./motion/Splash";

export function Providers({ children }: { children: ReactNode }) {
  // Sound effects wake on the first gesture (browsers block audio before it).
  useEffect(() => armSound(), []);
  return (
    <SmoothScroll>
      <Cursor />
      <Splash />
      {children}
    </SmoothScroll>
  );
}
