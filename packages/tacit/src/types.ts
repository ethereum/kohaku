import type { Address } from "ox/Address";
import type {
  PluginInstance,
  PICapCfg,
  CreatePluginFn,
  AssetAmount,
  PublicOperation,
  PrivateOperation,
  AssetId,
} from "@kohaku-eth/plugins";
import type { TxData } from "@kohaku-eth/provider";

// ── Tacit-specific operation types ──────────────────────────────

export type TacitPublicOperation = PublicOperation & {
  txns: TxData[];
};

export type TacitPrivateOperation = PrivateOperation & {
  crosschain: true;
  phase: "bitcoin-burn-required";
  burnEnvelope: {
    opcode: 0x61;
    networkTag: number;
    assetId: `0x${string}`;
    denomination: bigint;
    merkleRoot: `0x${string}`;
    nullifierHash: `0x${string}`;
    recipientCommitment: Uint8Array;
    rLeaf: `0x${string}`;
    ethRecipient: Address;
    burnNonce: `0x${string}`;
    bindHash: `0x${string}`;
    proof: Uint8Array;
    encoded: Uint8Array;
  };
  ethereum: {
    contractAddress: Address;
    poolId: `0x${string}`;
    denomination: bigint;
  };
  groth16Proof: {
    a: [bigint, bigint];
    b: [[bigint, bigint], [bigint, bigint]];
    c: [bigint, bigint];
    publicSignals: bigint[];
  };
};

// ── Plugin instance shape ───────────────────────────────────────

export type TacitAddress = `tacit:${string}`;

export type TacitAssetAmount = AssetAmount<AssetId, bigint, string>;

export type TacitCapabilities = PICapCfg<{
  features: {
    prepareShield: true;
    prepareShieldMulti: false;
    prepareTransfer: false;
    prepareTransferMulti: false;
    prepareUnshield: true;
    prepareUnshieldMulti: false;
  };
  assetAmounts: {
    input: TacitAssetAmount;
    internal: TacitAssetAmount;
    output: TacitAssetAmount;
    read: TacitAssetAmount;
  };
  publicOp: TacitPublicOperation;
  privateOp: TacitPrivateOperation;
  extras: {
    sync(): Promise<void>;
    deposits(): Promise<DepositRecord[]>;
    poolInfo(denomination: bigint): Promise<PoolInfo>;
  };
  credential: unknown;
}>;

export type TacitInstance = PluginInstance<TacitAddress, TacitCapabilities>;

// ── Plugin parameters ───────────────────────────────────────────

export type TacitPluginParameters = {
  mixerAddress: Address;
  chainId: bigint;
  networkTag: number;
  assetId: `0x${string}`;
  denominationsWei: bigint[];
  unitScale: bigint;
  token?: Address;
  circuitWasm?: ArrayBuffer;
  circuitZkey?: ArrayBuffer;
};

export type CreateTacitPlugin = CreatePluginFn<
  TacitInstance,
  TacitPluginParameters
>;

// ── Internal types ──────────────────────────────────────────────

export type DepositRecord = {
  commitment: `0x${string}`;
  leafIndex: number;
  denomination: bigint;
  poolId: `0x${string}`;
  timestamp: number;
  depositIndex: number;
};

export type PoolInfo = {
  poolId: `0x${string}`;
  denomination: bigint;
  nextLeafIndex: number;
  balance: bigint;
  currentRoot: `0x${string}`;
};
