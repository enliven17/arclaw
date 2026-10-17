import { clawArt } from "@/components/claw/geometry";
import { Reveals } from "@/components/motion/SmoothScroll";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/landing/Footer";
import { GiftShowcase } from "@/components/landing/GiftShowcase";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Machines } from "@/components/landing/Machines";
import { Odds } from "@/components/landing/Odds";
import { StocksMarquee } from "@/components/landing/StocksMarquee";
import { withResolved } from "@/lib/machines.server";
import { getQuotes } from "@/lib/prices";

// Prices refresh every five minutes (lib/prices.ts); the rest is static.
export const revalidate = 300;

// Each cabinet's static art is built here, on the server, and handed to the live components as element props.
const ART = { single: clawArt("single"), stack: clawArt("stack"), vault: clawArt("vault") };

export default async function Home() {
  const machines = withResolved();
  const quotes = await getQuotes();
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero art={ART} machines={machines} />
        <Machines art={ART} machines={machines} />
        <HowItWorks machines={machines} />
        <StocksMarquee quotes={quotes} />
        <GiftShowcase />
        <Odds machines={machines} />
      </main>
      <Footer art={ART} machines={machines} />
      <Reveals />
    </>
  );
}
