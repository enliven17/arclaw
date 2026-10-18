/** Asks the server for the signed /pull link of one box (it checks the reveal transaction on chain). */
export async function requestShareLink(txHash: string, boxIndex: number): Promise<string> {
  const res = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash, boxIndex }) });
  const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
  if (!res.ok || !body.path) throw new Error(body.error ?? "Sharing is not available right now.");
  return body.path;
}
