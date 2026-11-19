"use client";

/**
 * App-wide client providers: smooth scroll, the cursor, the splash, sound and Vercel Analytics. Analytics gets the path
 * only: a claim link carries its private key after the #, and a share link its signed fields after the ?. Solana wallets mount in the app
 * shell only (components/app/AppShell.tsx), so the marketing pages never load them.
 */
import { useEffect, type ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
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
      <Analytics beforeSend={(e) => ({ ...e, url: e.url.split(/[?#]/)[0]! })} />
    </SmoothScroll>
  );
}
