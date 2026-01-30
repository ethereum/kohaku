import { Address } from "viem";

abstract class Eq {
    abstract toString(): string;

    equals(other: Eq): boolean {
        return this.toString() === other.toString();
    }
}

/**
 * CAIP-2 Chain ID.
 * 
 * https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md
 * 
 *  - EVM chains represent public blockchains.
 *  - Custom chains may be used by plugins to represent private chains (IE 
 * `RAILGUN:1` for railgun assets on Ethereum mainnet).
 * 
 * @remarks Uses `string & {}` for typescript trickery to prevent extension of known 
 * namespaces for intelisense.
 */
export type ChainId = Eip155ChainId | CustomChainId;

export class Eip155ChainId<TReference extends number | undefined = number | undefined> extends Eq {
    readonly namespace = "eip155" as const;
    readonly reference: TReference;
    constructor(reference: TReference) {
        super();
        this.reference = reference;
    }

    toString(): string {
        const reference = this.reference ?? "*";
        return `${this.namespace}:${reference}`;
    }
};

export class CustomChainId<TNamespace extends string = string, TReference extends number = number> extends Eq {
    constructor(readonly namespace: TNamespace & {}, readonly reference: TReference) { super(); }

    toString(): string {
        return `${this.namespace}:${this.reference}`;
    }
};

/**
 * CAIP-19 Asset ID.
 * 
 * https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-19.md
 * 
 * - Native assets (slip44) represent native assets of blockchains (IE ETH on Ethereum,
 *   MATIC on Polygon).
 * - Erc20 assets represent fungible tokens.
 * 
 * @private Since on EVM chains the slip44 asset type is uniquely identified by 
 * the chain ID, I simplified the representation into a blackbox NativeAssetType.
 */
export type AssetId = NativeId | Erc20Id;

/**
 * Slip44 chain-specific native asset type.
 * 
 * @example Wildcard native asset
 * const native = new NativeId();
 * 
 * @example Ethereum native asset
 * const ethereum = new NativeId(new Eip155ChainId(1));
 * 
 * @example Polygon native asset
 * const polygon = new NativeId(new Eip155ChainId(137));
 */
export class NativeId<TChainId extends ChainId = ChainId> extends Eq {
    readonly namespace = "slip44" as const;
    readonly chainId: TChainId;
    constructor(chainId?: TChainId) {
        super();
        this.chainId = (chainId ?? new Eip155ChainId(undefined)) as TChainId;
    }

    toString(): string {
        return `${this.chainId.toString()}/${this.namespace}`;
    }
}

/**
 * ERC20 asset type.
 * 
 * @example Wildcard USDC
 * const usdc = new Erc20Id("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
 * 
 * @example USDC on ethereum
 * const usdcEthereum = new Erc20Id("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", new Eip155ChainId(1));
 * 
 * @example USDC on polygon
 * const usdcPolygon = new Erc20Id("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", new Eip155ChainId(137));
 */
export class Erc20Id<TChainId extends ChainId = ChainId, TReference extends Address = Address> extends Eq {
    readonly namespace = "erc20" as const;
    readonly chainId: TChainId;
    constructor(readonly reference: TReference, chainId?: TChainId) {
        super();
        this.chainId = (chainId ?? new Eip155ChainId(undefined)) as TChainId;
    }

    toString(): string {
        return `${this.chainId.toString()}/${this.namespace}:${this.reference}`;
    }
}

/**
 * CAIP-10 Account ID.
 * 
 * https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-10.md
 */
export type AccountId = Eip155AccountId | CustomAccountId;

/**
 * EIP-155 Account ID.
 * 
 * @example Wildcard account
 * const wildcardAccount = new Eip155AccountId("0xYourAddressHere");
 * 
 * @example Ethereum account
 * const ethAccount = new Eip155AccountId("0xYourAddressHere", new Eip155ChainId(1));
 */
export class Eip155AccountId<TChainId extends Eip155ChainId = Eip155ChainId, TAddress extends Address = Address> extends Eq {
    readonly kind = "eip155" as const;
    readonly chainId: TChainId;
    constructor(readonly address: TAddress, chainId?: TChainId) {
        super();
        this.chainId = (chainId ?? new Eip155ChainId(undefined)) as TChainId;
    }

    toString(): string {
        return `${this.chainId.toString()}/${this.address}`;
    }
}

export class CustomAccountId<TChainId extends CustomChainId = CustomChainId, TAddress extends string = string> extends Eq {
    readonly kind = "custom" as const;
    readonly chainId: TChainId;
    constructor(readonly address: TAddress, chainId: TChainId) {
        super();
        this.chainId = chainId;
    }

    toString(): string {
        return `${this.chainId.toString()}/${this.address}`;
    }
}
