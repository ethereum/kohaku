import {
  type AssetAmount,
  type ERC20AssetId,
  type NativeAssetId,
  type PluginInstance,
  type PrivateOperation,
  type PublicOperation,
} from "@kohaku-eth/plugins";
import { type Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { type TxData } from "@kohaku-eth/provider";
import { type TacitChainConfig } from "../config";
import { type Hex } from "../crypto/bytes";
import { type TransactTx } from "../pool/abi";
import { type ProverFactory } from "../prover/snarkjs";

/** Who sends the transaction: a relayer, paid from the shielded funds, or the user's own account. */
export type TacitMode = "relayer" | "self";

/** ETH, as the other plugins name it (the `0xeeee…` sentinel) or as the native asset. */
export type TacitAssetId = ERC20AssetId | NativeAssetId;
export type TacitAssetAmount = AssetAmount<TacitAssetId, bigint, undefined>;
export type TacitBalance = AssetAmount<ERC20AssetId, bigint, undefined>;

/** The pool address of a wallet (`bp1…`): what others pay privately. */
export type TacitAddress = string;

export type TacitPluginParameters = {
  /** Which identity to derive from the host's keystore, at `m/29793'/1'/{accountIndex}'`. Default 0. */
  accountIndex?: number;
  /**
   * A 32-byte Tacit identity key to use instead of one derived from the keystore, to open a balance made in
   * another Tacit app. It is not derived from the host's seed, so the host has to back it up itself.
   */
  identityKey?: Hex;
  /** The chain's deployment. Defaults to the entry of `TacitConfigs` for the provider's chain. */
  config?: TacitChainConfig;
  /** `relayer` (the default when the chain has one) or `self`. */
  mode?: TacitMode;
  /** Replaces the snarkjs prover, for example with a native one. */
  proverFactory?: ProverFactory;
  /** Run snarkjs without worker threads: slower, and no thread to release afterwards. */
  singleThread?: boolean;
};

/** Deposits are sent by the user's own account: one transaction, proven on this device. */
export interface TacitPublicOperation extends PublicOperation {
  txns: TxData[];
}

/** A proven spend. Nothing leaves the device until the operation is broadcast or its `txns` are sent. */
export interface TacitPrivateOperation extends PrivateOperation {
  mode: TacitMode;
  chainId: number;
  pool: Hex;
  /** The relayer base URL, in relayer mode. */
  relayerUrl?: string;
  /** The `transact` arguments the relayer submits. */
  tx: TransactTx;
  /** What the user's own account sends, in self mode. */
  txns: TxData[];
  /** The amount that reaches the recipient. */
  amount: bigint;
  /** The relayer's fee, paid from the shielded funds on top of `amount`. Zero in self mode. */
  fee: bigint;
}

/** Options of a spend. `mode` overrides the plugin's; `maxFee` (wei) is the most a relayer may charge, the fee the caller showed. */
export type TacitSpendOptions = { mode?: TacitMode; maxFee?: bigint };

export type TacitNote = { index: number; value: bigint; leaf: Hex; block: number };

export type TacitInstance = PluginInstance<
  TacitAddress,
  {
    features: { prepareShield: true; prepareTransfer: true; prepareUnshield: true };
    assetAmounts: { input: TacitAssetAmount; internal: TacitAssetAmount; output: TacitAssetAmount; read: TacitBalance };
    note: TacitNote;
    publicOp: TacitPublicOperation;
    privateOp: TacitPrivateOperation;
    extras: {
      /** Reads what is new from the pool. Every operation does this first. */
      sync(): Promise<void>;
      /** Rebuilds the synced state from the chain's logs alone, without the relayer's history feed. */
      rescan(): Promise<void>;
      /** The relayer's fee for one spend now, in wei. */
      quote(): Promise<bigint>;
      /** Merges the two largest notes into one, for a balance held in more notes than one spend can take. */
      prepareConsolidate(options?: TacitSpendOptions): Promise<TacitPrivateOperation>;
    };
  }
>;

export type TacitBroadcaster = Broadcaster<TacitPrivateOperation, { txHash: Hex }>;
