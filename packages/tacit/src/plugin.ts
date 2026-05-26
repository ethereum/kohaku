import type { Host, AssetAmount, AssetId } from "@kohaku-eth/plugins";
import type { TxData } from "@kohaku-eth/provider";
import type { Address } from "ox/Address";
import { Hash } from "ox/Hash";
import type {
  TacitInstance,
  TacitAddress,
  TacitAssetAmount,
  TacitPublicOperation,
  TacitPrivateOperation,
  TacitPluginParameters,
  CreateTacitPlugin,
  DepositRecord,
  PoolInfo,
} from "./types";
import {
  deriveDepositSecrets,
  deriveAccountId,
  computeNullifierHash,
  computeRLeaf,
} from "./keys";
import {
  computeLeafCommitment,
  bigintToBytes32,
} from "./commitment";

const DEPOSIT_SELECTOR = "0x1de26e16";
const APPROVE_SELECTOR = "0x095ea7b3";
const GET_POOL_ROOT_SELECTOR = "0xee59a615";
const GET_POOL_BALANCE_SELECTOR = "0x550e6ed1";
const GET_NEXT_LEAF_INDEX_SELECTOR = "0xde5ddc78";
const DEPOSIT_EVENT_TOPIC =
  "0x35a268a90c41b0181a3b58b12063b25c3597e0d085532dfff38eaf88e946c30e";

const STORAGE_KEY_DEPOSITS = "tacit:deposits";
const STORAGE_KEY_NEXT_INDEX = "tacit:nextDepositIndex";

class TacitProtocol implements TacitInstance {
  private host: Host;
  private params: TacitPluginParameters;
  private accountId: TacitAddress;
  private depositCache: DepositRecord[] = [];
  private nextDepositIndex: number = 0;

  constructor(host: Host, params: TacitPluginParameters) {
    this.host = host;
    this.params = params;
    this.accountId = deriveAccountId(host.keystore, params.chainId);

    const stored = host.storage.get(STORAGE_KEY_DEPOSITS);
    if (stored) {
      this.depositCache = JSON.parse(stored, (_k, v) =>
        typeof v === "string" && v.startsWith("0n")
          ? BigInt(v.slice(2))
          : v
      );
    }
    const idx = host.storage.get(STORAGE_KEY_NEXT_INDEX);
    this.nextDepositIndex = idx ? parseInt(idx, 10) : 0;
  }

  async instanceId(): Promise<TacitAddress> {
    return this.accountId;
  }

  async balance(
    assets: AssetAmount<AssetId>["asset"][] | undefined
  ): Promise<TacitAssetAmount[]> {
    const results: TacitAssetAmount[] = [];
    for (const denomWei of this.params.denominationsWei) {
      const asset: AssetId = this.params.token
        ? { __type: "erc20", contract: this.params.token as Address }
        : { __type: "native" };

      if (assets && !assets.some((a) => a.__type === asset.__type)) continue;

      const poolId = this.poolIdFromWei(denomWei);
      const userDeposits = this.depositCache.filter(
        (d) => d.poolId === poolId
      );
      const userBalance = BigInt(userDeposits.length) * denomWei;
      results.push({ asset, amount: userBalance });
    }
    return results;
  }

  async prepareShield(
    asset: TacitAssetAmount,
    _to?: TacitAddress
  ): Promise<TacitPublicOperation> {
    const denomWei = this.findDenominationWei(asset.amount);
    const denomTacit = denomWei / this.params.unitScale;
    const depositIndex = this.nextDepositIndex;
    const { secret, nullifierPreimage } = deriveDepositSecrets(
      this.host.keystore,
      this.params.chainId,
      depositIndex
    );

    const leaf = computeLeafCommitment(secret, nullifierPreimage, denomTacit);
    const commitment = bigintToBytes32(leaf);
    const poolId = this.poolIdFromWei(denomWei);

    const isNative = !this.params.token;
    const txns: TxData[] = [];

    if (!isNative && this.params.token) {
      txns.push({
        to: this.params.token,
        data: abiEncode(APPROVE_SELECTOR, [
          padAddress(this.params.mixerAddress),
          bigintToBytes32(denomWei),
        ]),
        value: 0n,
      });
    }

    txns.push({
      to: this.params.mixerAddress,
      data: abiEncode(DEPOSIT_SELECTOR, [
        commitment,
        bigintToBytes32(denomWei),
      ]),
      value: isNative ? denomWei : 0n,
    });

    const record: DepositRecord = {
      commitment,
      leafIndex: -1,
      denomination: denomWei,
      poolId,
      timestamp: Date.now(),
      depositIndex,
    };
    this.depositCache.push(record);
    this.nextDepositIndex++;
    this.persistState();

    return { __type: "publicOperation", txns };
  }

  async prepareUnshield(
    asset: TacitAssetAmount,
    to: Address
  ): Promise<TacitPrivateOperation> {
    const denomWei = this.findDenominationWei(asset.amount);
    const denomTacit = denomWei / this.params.unitScale;
    const poolId = this.poolIdFromWei(denomWei);

    const deposit = this.depositCache.find(
      (d) => d.poolId === poolId && d.leafIndex >= 0
    );
    if (!deposit) {
      throw new Error("no confirmed deposit found for this denomination");
    }

    const { secret, nullifierPreimage } = deriveDepositSecrets(
      this.host.keystore,
      this.params.chainId,
      deposit.depositIndex
    );
    const nullifierHash = computeNullifierHash(nullifierPreimage);
    const rLeaf = computeRLeaf(secret, nullifierPreimage);

    const rootHex = await this.host.provider.call({
      to: this.params.mixerAddress as `0x${string}`,
      data: abiEncode(GET_POOL_ROOT_SELECTOR, [poolId]),
    });
    const merkleRoot = (rootHex ?? bigintToBytes32(0n)) as `0x${string}`;

    const burnNonce = bigintToBytes32(
      BigInt(deposit.depositIndex) * 2n ** 128n +
        BigInt(deposit.timestamp)
    );

    // Wallet must compute these with secp256k1 and SHA256 respectively.
    // See TacitBridgeMixer._validateBurn for the exact bindHash preimage.
    const recipientCommitment = new Uint8Array(33);
    const bindHash = bigintToBytes32(0n) as `0x${string}`;

    // Wallet must call snarkjs.groth16.fullProve with circuit WASM + zkey.
    // Public inputs: [root, nullifierHash, denomTacit, rLeaf, bindHash].
    const groth16Proof = {
      a: [0n, 0n] as [bigint, bigint],
      b: [
        [0n, 0n],
        [0n, 0n],
      ] as [[bigint, bigint], [bigint, bigint]],
      c: [0n, 0n] as [bigint, bigint],
      publicSignals: [
        BigInt(merkleRoot),
        nullifierHash,
        denomTacit,
        rLeaf,
        0n,
      ],
    };

    const encoded = new Uint8Array(281 + 256);

    return {
      __type: "privateOperation",
      crosschain: true,
      phase: "bitcoin-burn-required",
      burnEnvelope: {
        opcode: 0x61,
        networkTag: this.params.networkTag,
        assetId: this.params.assetId,
        denomination: denomTacit,
        merkleRoot,
        nullifierHash: bigintToBytes32(nullifierHash),
        recipientCommitment,
        rLeaf: bigintToBytes32(rLeaf),
        ethRecipient: to,
        burnNonce,
        bindHash,
        proof: new Uint8Array(256),
        encoded,
      },
      ethereum: {
        contractAddress: this.params.mixerAddress,
        poolId,
        denomination: denomWei,
      },
      groth16Proof,
    };
  }

  async sync(): Promise<void> {
    for (const record of this.depositCache) {
      if (record.leafIndex >= 0) continue;
      const logs = await this.host.provider.getLogs({
        address: this.params.mixerAddress as `0x${string}`,
        topics: [
          DEPOSIT_EVENT_TOPIC,
          record.poolId,
          record.commitment,
        ],
        fromBlock: 0n,
        toBlock: "latest",
      });
      if (logs.length > 0) {
        record.leafIndex = Number(BigInt(logs[0].data.slice(0, 66)));
      }
    }
    this.persistState();
  }

  async deposits(): Promise<DepositRecord[]> {
    return [...this.depositCache];
  }

  async poolInfo(denomination: bigint): Promise<PoolInfo> {
    const poolId = this.poolIdFromWei(denomination);
    const [rootHex, balanceHex, indexHex] = await Promise.all([
      this.host.provider.call({
        to: this.params.mixerAddress as `0x${string}`,
        data: abiEncode(GET_POOL_ROOT_SELECTOR, [poolId]),
      }),
      this.host.provider.call({
        to: this.params.mixerAddress as `0x${string}`,
        data: abiEncode(GET_POOL_BALANCE_SELECTOR, [poolId]),
      }),
      this.host.provider.call({
        to: this.params.mixerAddress as `0x${string}`,
        data: abiEncode(GET_NEXT_LEAF_INDEX_SELECTOR, [poolId]),
      }),
    ]);
    return {
      poolId,
      denomination,
      nextLeafIndex: Number(BigInt(indexHex ?? "0x0")),
      balance: BigInt(balanceHex ?? "0x0"),
      currentRoot: (rootHex as `0x${string}`) ?? bigintToBytes32(0n),
    };
  }

  private poolIdFromWei(denomWei: bigint): `0x${string}` {
    const assetPadded = this.params.assetId.slice(2).padStart(64, "0");
    const denomPadded = denomWei.toString(16).padStart(64, "0");
    return Hash.keccak256(`0x${assetPadded}${denomPadded}`);
  }

  private findDenominationWei(amount: bigint): bigint {
    const denom = this.params.denominationsWei.find((d) => d === amount);
    if (!denom) {
      throw new Error(
        `amount ${amount} does not match any pool denomination`
      );
    }
    return denom;
  }

  private persistState(): void {
    this.host.storage.set(
      STORAGE_KEY_DEPOSITS,
      JSON.stringify(this.depositCache, (_k, v) =>
        typeof v === "bigint" ? `0n${v}` : v
      )
    );
    this.host.storage.set(
      STORAGE_KEY_NEXT_INDEX,
      String(this.nextDepositIndex)
    );
  }
}

export const createTacitPlugin: CreateTacitPlugin = (
  host: Host,
  params: TacitPluginParameters
): TacitInstance => {
  return new TacitProtocol(host, params);
};

function abiEncode(
  selector: string,
  args: (`0x${string}`)[]
): `0x${string}` {
  const encoded = args
    .map((a) => a.slice(2).padStart(64, "0"))
    .join("");
  return `${selector}${encoded}` as `0x${string}`;
}

function padAddress(addr: string): `0x${string}` {
  return `0x${addr.slice(2).padStart(64, "0")}`;
}
