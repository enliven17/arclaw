import type { Metadata } from "next";
import { clawArt } from "@/components/claw/geometry";
import { Reveals } from "@/components/motion/SmoothScroll";
import { SiteHeader } from "@/components/SiteHeader";
import { AuthorBio } from "@/components/landing/AuthorBio";
import { Faq } from "@/components/landing/Faq";
import { Footer } from "@/components/landing/Footer";
import { GiftShowcase } from "@/components/landing/GiftShowcase";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Machines } from "@/components/landing/Machines";
import { Odds } from "@/components/landing/Odds";
import { Tokenomics } from "@/components/landing/Tokenomics";
import { StocksMarquee } from "@/components/landing/StocksMarquee";
import { SiteStructuredData } from "@/components/seo/SiteStructuredData";
import { withResolved } from "@/lib/machines.server";
import { getQuotes } from "@/lib/prices";
import { SITE_DESCRIPTION, SITE_NAME, TAGLINE, X_HANDLE } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME}: ${TAGLINE}` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: `${SITE_NAME}: ${TAGLINE}`, description: SITE_DESCRIPTION, type: "website", url: "/" },
  twitter: { card: "summary_large_image", site: X_HANDLE, creator: X_HANDLE, title: `${SITE_NAME}: ${TAGLINE}`, description: SITE_DESCRIPTION },
};

// Prices refresh every five minutes (lib/prices.ts); the rest is static.
export const revalidate = 300;
// Keep the marketing page server-rendered and cacheable. Client components add motion after the HTML arrives.
export const dynamic = "force-static";

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
        <Tokenomics />
        <Odds machines={machines} />
        <AuthorBio />
        <Faq />
      </main>
      <Footer art={ART} machines={machines} />
      <SiteStructuredData />
      <Reveals />
    </>
  );
}
