import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/Providers";
import { fontVariables } from "@/lib/fonts";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, TAGLINE } from "@/lib/seo";
import "./globals.css";

// Icons and the share card come from app/icon.svg, app/opengraph-image.tsx and app/twitter-image.tsx.
export const metadata: Metadata = {
  metadataBase: SITE_URL,
  applicationName: SITE_NAME,
  title: { default: `${SITE_NAME}: ${TAGLINE}`, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  openGraph: { siteName: SITE_NAME, type: "website", locale: "en_US", title: `${SITE_NAME}: ${TAGLINE}`, description: SITE_DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: `${SITE_NAME}: ${TAGLINE}`, description: SITE_DESCRIPTION },
};

export const viewport: Viewport = { themeColor: "#0c0c0e", colorScheme: "dark", viewportFit: "cover" };

// Before first paint: mark JS so reveal targets start hidden (no-JS keeps them visible), and decide the splash
// (first visit per tab session, never under reduced motion) so it never flashes for a returning visitor.
const HEAD = `(function(){var d=document.documentElement;d.classList.add('js');try{if(!sessionStorage.getItem('arclaw:splash')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)d.classList.add('splashing')}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HEAD }} />
      </head>
      <body className="min-h-dvh bg-ink text-cream">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-[10px] focus:bg-cream focus:px-3 focus:py-2 focus:text-ink"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
