import { createPublicClient, http, parseAbi, encodeFunctionData, zeroAddress } from "viem";
const c = createPublicClient({ transport: http("https://rpc.testnet.arc.io") });
const FACTORY = "0x0000000DF7E6c9Dc387cAFc5eCBfa6c3a6179AdD";
console.log("factory code bytes", ((await c.getCode({ address: FACTORY })) ?? "0x").length / 2 - 1);
for (const fn of ["accountImplementation", "ACCOUNT_IMPLEMENTATION", "getImplementation", "accountImpl"]) {
  try {
    const r = await c.readContract({ address: FACTORY, abi: parseAbi([`function ${fn}() view returns (address)`]), functionName: fn });
    console.log(fn, r);
    const code = await c.getCode({ address: r });
    console.log("impl code bytes", (code ?? "0x").length / 2 - 1, "has f23a6e61:", code?.includes("f23a6e61"), "has bc197c81:", code?.includes("bc197c81"), "has 4e2312e0:", code?.includes("4e2312e0"));
    const data = encodeFunctionData({ abi: parseAbi(["function onERC1155Received(address,address,uint256,uint256,bytes) returns (bytes4)"]), functionName: "onERC1155Received", args: [zeroAddress, zeroAddress, 1n, 1n, "0x"] });
    try { console.log("onERC1155Received ->", (await c.call({ to: r, data })).data); } catch (e) { console.log("onERC1155Received reverted:", e.shortMessage); }
    try { console.log("supportsInterface(IERC1155Receiver) ->", await c.readContract({ address: r, abi: parseAbi(["function supportsInterface(bytes4) view returns (bool)"]), functionName: "supportsInterface", args: ["0x4e2312e0"] })); } catch (e) { console.log("supportsInterface reverted:", e.shortMessage); }
  } catch {}
}
