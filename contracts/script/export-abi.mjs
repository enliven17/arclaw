// Regenerates ../lib/abi/*.ts from forge artifacts (run `forge build` first):
//   node script/export-abi.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', '..', 'lib', 'abi')
const artifacts = join(here, '..', 'out')

const notes = {
  Arclaw: [
    'Frontend rules:',
    '- Claim links live in ArclawLinks (lib/abi/arclawLinks.ts). Create one with a single transfer:',
    '  arclaw.safeTransferFrom(user, links, machineId, boxes, abi.encode(linkKey, expiresAt)). Share the URL only',
    '  AFTER that transfer is confirmed: a front-run reusing the pending linkKey (audit #2 L-3) makes it revert',
    '  with LinkKeyUsed, and that link must not be shared. Generate a fresh key and retry.',
    '- VRF fee: quote with coordinator.quoteFeeAt(callbackGasLimit, latest baseFee) plus a buffer (never',
    '  quoteFee via eth_call). open() is subsidised; retry() is free only for the opener, a keeper or the operator.',
    '  An opener top-up is paid back when the request expires (openingTopUp). retry() reverts TableStale/BelowFloor',
    '  once the pinned table can no longer open; returnBoxes() reverts NotExpired until the table aged out',
    '  (tablePricedAt + maxTableAge); 7 days after the request it also works when the coordinator is dead.',
    '  refundSealed(machineId, boxes) pays sealed boxes back once the machine has been off (offSince), its table',
    '  stale, or the contract paused (pausedSince) for 3 days, counted from the earliest; NotExpired before that.',
    '- Native pushes forward 100k gas; a wallet that needs more (or rejects) gets credit, claimCredit() pulls it.',
    '- Reads that moved off-chain for size: stats and quoteVrfFee live in ArclawLens (lib/abi/arclawLens.ts).',
  ],
}

const items = [
  ['Arclaw', 'arclaw'],
  ['ArclawLens', 'arclawLens'],
  ['ArclawLinks', 'arclawLinks'],
  ['LuckVault', 'luckVault'],
  ['AstockPriceSource', 'astockPriceSource'],
  ['MockStock', 'mockStock'],
  ['MockPriceSource', 'mockPriceSource'],
  ['MockAstockDesk', 'mockAstockDesk'],
]

const index = []
for (const [contract, name] of items) {
  const { abi } = JSON.parse(readFileSync(join(artifacts, `${contract}.sol`, `${contract}.json`), 'utf8'))
  const header = [
    `// Generated from contracts/out/${contract}.sol/${contract}.json by contracts/script/export-abi.mjs. Do not edit.`,
    ...(notes[contract] ?? []).map((l) => `// ${l}`),
  ].join('\n')
  writeFileSync(join(out, `${name}.ts`), `${header}\nexport const ${name}Abi = ${JSON.stringify(abi, null, 2)} as const\n`)
  index.push(`export { ${name}Abi } from './${name}'`)
}
index.push(`export { d20CoordinatorAbi } from './d20Coordinator'`)
writeFileSync(join(out, 'index.ts'), index.join('\n') + '\n')
console.log('wrote', items.length, 'abis to', out)
