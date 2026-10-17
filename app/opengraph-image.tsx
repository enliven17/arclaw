/** The site's share card; every page without its own inherits it. */
import { ogResponse } from "@/lib/og/response";
import { SiteCard } from "@/lib/og/cards";
import { SITE_CARD_ALT } from "@/lib/seo";

export const runtime = "nodejs";
export const alt = SITE_CARD_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return ogResponse(<SiteCard />);
}
