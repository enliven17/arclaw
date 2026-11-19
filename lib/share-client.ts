/** Asks the server for the signed /pull link of one pack (it checks the settle transaction on Solana). */
export async function requestShareLink(signature: string): Promise<string> {
  const res = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature }) });
  const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
  if (!res.ok || !body.path) throw new Error(body.error ?? "Sharing is not available right now.");
  return body.path;
}

/** Opens an X post with the pack's /pull link. The tab opens first, inside the click, so the popup blocker lets it through. */
export function shareOnX(signature: string, text: string) {
  const tab = window.open("", "_blank");
  void requestShareLink(signature).then(
    (path) => {
      const url = `https://x.com/intent/post?${new URLSearchParams({ text, url: `${window.location.origin}${path}` })}`;
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
    },
    () => tab?.close(),
  );
}
