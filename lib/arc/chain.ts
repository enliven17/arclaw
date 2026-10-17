/**
 * Arc as a viem chain, a read client on its RPCs, and the fee rule. viem core only, no wallet SDKs.
 *
 * Native USDC has 18 decimals (what msg.value spends); the ERC-20 view at ARC_USDC has 6. This module only ever
 * deals in the native 18 dp amounts.
 */
import { createPublicClient, defineChain, fallback, http, type PublicClient, type Transport } from "viem";
import { ARC, MIN_FEE_PER_GAS, type ArcConfig } from "./config";

export function arcChain(config: ArcConfig = ARC) {
  return defineChain({
    id: config.chain.id,
    name: config.chain.name,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: config.chain.rpcUrls } },
    blockExplorers: { default: { name: "Arcscan", url: config.chain.explorer } },
    fees: {
      // Arc drops anything priced under 20 gwei: never go below it, whatever the node suggests.
      async estimateFeesPerGas({ client }) {
        const block = await client.request({ method: "eth_gasPrice" }).then(BigInt).catch(() => MIN_FEE_PER_GAS);
        const base = block > MIN_FEE_PER_GAS ? block : MIN_FEE_PER_GAS;
        const tip = 1_000_000_000n;
        return { maxFeePerGas: base * 2n + tip, maxPriorityFeePerGas: tip };
      },
    },
  });
}

export const ARC_CHAIN = arcChain();

/** The configured RPCs in order: the next takes over when one fails. */
export function arcTransport(config: ArcConfig = ARC): Transport {
  const urls = config.chain.rpcUrls;
  return urls.length === 1 ? http(urls[0]) : fallback(urls.map((u) => http(u)));
}

let client: PublicClient | null = null;
export function arcClient(): PublicClient {
  client ??= createPublicClient({ chain: ARC_CHAIN, transport: arcTransport() }) as PublicClient;
  return client;
}
