import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/Providers";
import { ClawCurtain } from "@/components/motion/ClawCurtain";
import { PageTransition } from "@/components/motion/PageTransitions";
import { fontVariables } from "@/lib/fonts";
import { HEAD_SCRIPT } from "@/lib/csp";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, TAGLINE } from "@/lib/seo";
import "./globals.css";

// Icons and the share card come from app/icon.svg, app/opengraph-image.tsx and app/twitter-image.tsx.
export const metadata: Metadata = {
  metadataBase: SITE_URL,
  applicationName: SITE_NAME,
  title: { default: `${SITE_NAME}: ${TAGLINE}`, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  openGraph: { siteName: SITE_NAME, type: "website", locale: "en_US", title: `${SITE_NAME}: ${TAGLINE}`, description: SITE_DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${SITE_NAME}: ${TAGLINE}`, description: SITE_DESCRIPTION },
};

export const viewport: Viewport = { themeColor: "#0c0c0e", colorScheme: "dark", viewportFit: "cover" };


export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* lib/csp.ts: allowed by its hash on the strict pages */}
        <script dangerouslySetInnerHTML={{ __html: HEAD_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-ink text-cream">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-[10px] focus:bg-cream focus:px-3 focus:py-2 focus:text-ink"
        >
          Skip to content
        </a>
        <Providers>
          <PageTransition>{children}</PageTransition>
          <ClawCurtain />
        </Providers>
      </body>
    </html>
  );
}
