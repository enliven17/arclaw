import { clawArt } from "@/components/claw/geometry";
import { Reveals } from "@/components/motion/SmoothScroll";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/landing/Footer";
import { Gift } from "@/components/landing/Gift";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Odds } from "@/components/landing/Odds";
import { StocksMarquee } from "@/components/landing/StocksMarquee";

// The cabinet's static art is built here, on the server, and handed to the live component as element props.
const ART = clawArt();

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero art={ART} />
        <HowItWorks />
        <Gift />
        <StocksMarquee />
        <Odds />
      </main>
      <Footer />
      <Reveals />
    </>
  );
}
