/** Asks the server for the signed /pull link of one box (it checks the reveal transaction on chain). */
export async function requestShareLink(txHash: string, boxIndex: number): Promise<string> {
  const res = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash, boxIndex }) });
  const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
  if (!res.ok || !body.path) throw new Error(body.error ?? "Sharing is not available right now.");
  return body.path;
}

/** Opens an X post with the box's /pull link. The tab opens first, inside the click, so the popup blocker lets it through. */
export function shareOnX(txHash: string, boxIndex: number, text: string) {
  const tab = window.open("", "_blank");
  void requestShareLink(txHash, boxIndex).then(
    (path) => {
      const url = `https://x.com/intent/post?${new URLSearchParams({ text, url: `${window.location.origin}${path}` })}`;
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
    },
    () => tab?.close(),
  );
}
