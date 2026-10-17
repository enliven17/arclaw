// Subset of @d20dao/vrf-sdk@0.6.2 abi/D20VRFCoordinator.json: quoting, request reads, recovery, events and all errors
// (coordinator reverts bubble through Arclaw.open/retry; decode them with this ABI).
export const d20CoordinatorAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "target",
        "type": "address"
      }
    ],
    "name": "AddressEmptyCode",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AlreadyDelivered",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AlreadyFulfilled",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BlockHashUnavailable",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ContractConsumerRequired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "implementation",
        "type": "address"
      }
    ],
    "name": "ERC1967InvalidImplementation",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ERC1967NonPayable",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EpochUnavailable",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EvidencePacketTooLarge",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "FailedCall",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "FeeOverflow",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "IncorrectFee",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InsufficientCallbackGas",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidBatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidCallbackGas",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidConfig",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidInitialization",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidMapping",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidPublicKey",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidRefundAddress",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidScan",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoKeeperCredit",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoRefundCredit",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotFulfilled",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotInitializing",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotReady",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotRefunded",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OnlyFeeRecipient",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "OwnableInvalidOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "OwnableUnauthorizedAccount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ReentrancyGuardReentrantCall",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "RefundCallbackAlreadyDelivered",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "RefundNotAvailable",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "RenounceDisabled",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "RequestExpired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "RequestRefunded",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TransferFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UUPSUnauthorizedCallContext",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "slot",
        "type": "bytes32"
      }
    ],
    "name": "UUPSUnsupportedProxiableUUID",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UnknownRequest",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "WrongPublicKey",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "WrongSeed",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "success",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "gasLimit",
        "type": "uint32"
      }
    ],
    "name": "CallbackAttempted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "randomness",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "submitter",
        "type": "address"
      }
    ],
    "name": "RandomnessFulfilled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "consumer",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "keyHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "clientSeed",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "requestBlock",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "callbackGasLimit",
        "type": "uint32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "feePaid",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "refundAddress",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "deadline",
        "type": "uint64"
      }
    ],
    "name": "RandomnessRequested",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "refundAddress",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "paid",
        "type": "bool"
      }
    ],
    "name": "RequestRefundedTo",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      }
    ],
    "name": "getMappedResult",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      }
    ],
    "name": "getRequest",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "consumer",
            "type": "address"
          },
          {
            "internalType": "uint32",
            "name": "callbackGasLimit",
            "type": "uint32"
          },
          {
            "internalType": "uint64",
            "name": "requestBlock",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "targetBlock",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "deadline",
            "type": "uint64"
          },
          {
            "internalType": "address",
            "name": "refundAddress",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "clientSeed",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "mappingHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "blockHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "randomness",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "proofHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "transcriptHash",
            "type": "bytes32"
          },
          {
            "internalType": "bool",
            "name": "fulfilled",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "delivered",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "refunded",
            "type": "bool"
          },
          {
            "internalType": "uint64",
            "name": "epochId",
            "type": "uint64"
          },
          {
            "internalType": "bytes32",
            "name": "epochHash",
            "type": "bytes32"
          }
        ],
        "internalType": "struct D20VRFCoordinator.Request",
        "name": "result",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pricing",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      },
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      },
      {
        "internalType": "uint32",
        "name": "",
        "type": "uint32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "callbackGasLimit",
        "type": "uint32"
      }
    ],
    "name": "quoteFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "callbackGasLimit",
        "type": "uint32"
      },
      {
        "internalType": "uint256",
        "name": "baseFee",
        "type": "uint256"
      }
    ],
    "name": "quoteFeeAt",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      }
    ],
    "name": "refundRequest",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      },
      {
        "internalType": "uint32",
        "name": "gasLimit",
        "type": "uint32"
      }
    ],
    "name": "retryCallback",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const
