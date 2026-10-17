import { createPublicClient, http, toFunctionSelector, getAddress } from "viem";
const c = createPublicClient({ transport: http("https://rpc.mainnet.arc.io") });
const DESK = "0x3ac68fc2ad55599fa528fefa1f05cc1c1df26d69";
const slot = await c.getStorageAt({ address: DESK, slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" });
const impl = getAddress(`0x${slot.slice(-40)}`);
const code = (await c.getCode({ address: impl })) ?? "0x";
console.log("impl", impl, "bytes", code.length / 2 - 1);
for (const sig of ["sell(address,uint256,uint256,address)", "quoteSell(address,uint256)", "quoteBuy(address,uint256)", "quoteSell(address,uint256,address)", "sellQuote(address,uint256)", "previewSell(address,uint256)", "quote(address,uint256)", "buy(address,uint256,address)", "feeBps()", "sellFeeBps()", "spreadBps()"]) {
  const sel = toFunctionSelector(sig).slice(2);
  console.log(code.includes(sel) ? "YES" : "no ", sig, sel);
}
import { encodeFunctionData, parseAbi } from "viem";
const NVDA = "0x0A2dd7160De0c452ED4642d498162550Fe2165f2";
const r = await c.call({ to: DESK, data: encodeFunctionData({ abi: parseAbi(["function quoteSell(address,uint256)"]), functionName: "quoteSell", args: [NVDA, 10n ** 18n] }) });
console.log("quoteSell raw", r.data);
const dec = await c.readContract({ address: NVDA, abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" });
console.log("NVDA.arc decimals", dec);
