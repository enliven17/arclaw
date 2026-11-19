import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";
import { StructuredData } from "./StructuredData";

export function SiteStructuredData() {
  const url = SITE_URL.toString();
  return (
    <>
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE_NAME,
          url,
          description: SITE_DESCRIPTION,
        }}
      />
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: SITE_NAME,
          url,
          logo: new URL("/brand/lockup.svg", SITE_URL).toString(),
          description: "An on-chain arcade where every play opens into tokenized stock cards on Solana.",
        }}
      />
    </>
  );
}
