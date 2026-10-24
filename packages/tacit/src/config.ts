import { type Hex } from "./crypto/bytes";

/** The native-asset sentinel the other plugins use for ETH. */
export const E_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/** One chain the pool is deployed on. */
export type TacitChainConfig = {
  chainId: number;
  /** `TacitEvmPool`, native ETH. The same address on every chain. */
  pool: Hex;
  /** The block the pool was deployed in; history is read from here. */
  deployBlock: number;
  /** Blocks per `eth_getLogs` window. Narrowed on its own when a node refuses a range. Default 5,000. */
  logChunk?: number;
  /** History is kept once it is this many blocks deep. */
  confirmations: number;
  /** The relayer's base URL, `…/evm-pool/keeper`. Without one every spend is sent by the user's own account. */
  relayerUrl?: string;
  /** The address the relayer must quote from. A quote from any other address is refused. */
  relayerAddress?: Hex;
  /** The most a relayed spend may pay the relayer, in wei. A dearer quote is refused. */
  maxRelayFee: bigint;
};

const POOL = "0x000000c2A20657CE25f2Ba99737933D031AFBEE9";

/** The chains the pool is deployed on, by chain id. */
export const TacitConfigs: Record<number, TacitChainConfig> = {
  1: {
    chainId: 1,
    pool: POOL,
    deployBlock: 26069245,
    confirmations: 12,
    relayerUrl: "https://tacit-evm-pool-keeper.onrender.com/evm-pool/keeper",
    relayerAddress: "0x7c9f8aE4e48Cbb2727F95b6477a1cf92bCFc43D0",
    maxRelayFee: 5n * 10n ** 16n,
  },
  8453: {
    chainId: 8453,
    pool: POOL,
    deployBlock: 51864014,
    confirmations: 12,
    relayerUrl: "https://tacit-evm-pool-keeper-base.onrender.com/evm-pool/keeper",
    relayerAddress: "0xfA2afbaB631C7Eda7CeA6AE1440605C504E322Ec",
    maxRelayFee: 2n * 10n ** 15n,
  },
  4663: {
    chainId: 4663,
    pool: POOL,
    deployBlock: 73991661,
    confirmations: 12,
    relayerUrl: "https://tacit-evm-pool-keeper-robinhood.onrender.com/evm-pool/keeper",
    relayerAddress: "0xc1F8DAc6BC910A5A794b4795b5F9997e0E8A5Fad",
    maxRelayFee: 2n * 10n ** 15n,
  },
  4326: {
    chainId: 4326,
    pool: POOL,
    deployBlock: 28397750,
    logChunk: 100_000,
    confirmations: 200,
    relayerUrl: "https://tacit-evm-pool-keeper-megaeth.onrender.com/evm-pool/keeper",
    relayerAddress: "0x69e4ea1992561Ce129713899244209Fd955E7D89",
    maxRelayFee: 2n * 10n ** 15n,
  },
};

/**
 * Where the proving files live, and the pins every copy is checked against. The files are the output of the pool's
 * public trusted-setup ceremony; any mirror will do, because nothing is used before its hash matches.
 */
export const TacitArtifacts = {
  wasm: {
    sha256: "02dd5e84970e5bc629a7a3cd4d7eae5fc9ca05579fa22c9b39b5ea70c8d8a6c1",
    urls: [
      "https://tacit.finance/evm-pool/transact.wasm",
      "https://ipfs.io/ipfs/bafybeia7b7euebs6dr7muhhvwf4yh472ftxodikyecxubipam4d7o7sxta",
    ],
  },
  zkey: {
    sha256: "40758061a0786fb0bdc5e5dec4c354bbf85fc106f7412716e25e781af4e79c4b",
    urls: [
      "https://tacit.finance/evm-pool/transact_final.zkey",
      "https://ipfs.io/ipfs/bafybeia6c36bgww2svm6jfg6nl2pk337prc7t6gcfsvhuo5sufqjpi7z4a",
    ],
  },
  vk: {
    /** The pin on the verification key's content (see `vkHash`), not on its file bytes. */
    hash: "43d11e6e1607e1ea7f3980c9bca91beed95e2e80d173d0873189e99d402e5757",
    urls: [
      "https://tacit.finance/evm-pool/transact_vk.json",
      "https://ipfs.io/ipfs/bafkreiht4nvma2wvsquaao4qvpmaxadrqc5n5mdmhfqmkcygb26ftnrgwm",
    ],
  },
} as const;

/** The BIP-32 purpose the plugin derives its identity key under: `m/29793'/1'/{accountIndex}'`. */
export const TACIT_DERIVATION_PURPOSE = 29793;
