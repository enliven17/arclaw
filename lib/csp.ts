/**
 * Content Security Policy, in two strengths.
 *
 *   static pages (next.config.ts)   inline scripts allowed: Next's bootstrap is inline and a static page has no
 *                                   per-request nonce. Scripts from other origins are still refused.
 *   /app and /claim (proxy.ts)      a fresh nonce per request plus 'strict-dynamic': only scripts Next marks with the
 *                                   nonce run, and the head script below by its hash. This is where wallets sign and
 *                                   gift keys live, so an injected script there has nothing to run with.
 *
 * Everything else is shared: nobody can frame the site, no plugins, no base-tag or form hijacking. Network and image
 * sources stay open to https because wallet SDKs (WalletConnect relays, Coinbase, MetaMask), RPCs, Convex and the
 * stock logos live on many hosts, and a missing one would silently break connecting a wallet.
 */

/** Before first paint: mark JS so reveal targets start hidden (no-JS keeps them visible), and decide the splash (first
 *  visit per tab session, never under reduced motion) so it never flashes for a returning visitor. */
export const HEAD_SCRIPT = `(function(){var d=document.documentElement;d.classList.add('js');try{if(!sessionStorage.getItem('arclaw:splash')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)d.classList.add('splashing')}catch(e){}})()`;

export const STATIC_SCRIPT_SRC = "'self' 'unsafe-inline' https://va.vercel-scripts.com";

export const policy = (scriptSrc: string) =>
  [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self' https: wss:",
    "frame-src https://verify.walletconnect.com https://verify.walletconnect.org",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

let headHash: Promise<string> | null = null;
/** 'sha256-...' of HEAD_SCRIPT, for the strict policy. */
export function headScriptHash(): Promise<string> {
  headHash ??= crypto.subtle.digest("SHA-256", new TextEncoder().encode(HEAD_SCRIPT)).then((b) => `'sha256-${btoa(String.fromCharCode(...new Uint8Array(b)))}'`);
  return headHash;
}

/** The strict policy for one request. */
export async function strictPolicy(nonce: string, dev = process.env.NODE_ENV !== "production"): Promise<string> {
  // React needs eval in development only (Next's CSP guide)
  return policy(`'self' 'nonce-${nonce}' 'strict-dynamic' ${await headScriptHash()}${dev ? " 'unsafe-eval'" : ""}`);
}
