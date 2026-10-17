// Generated from contracts/out/ArclawLens.sol/ArclawLens.json by contracts/script/export-abi.mjs. Do not edit.
export const arclawLensAbi = [
  {
    "type": "function",
    "name": "quoteVrfFee",
    "inputs": [
      {
        "name": "box",
        "type": "address",
        "internalType": "contract Arclaw"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "stats",
    "inputs": [
      {
        "name": "box",
        "type": "address",
        "internalType": "contract Arclaw"
      },
      {
        "name": "machineId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "rtpBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "totalWeight",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  }
] as const
