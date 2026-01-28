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
export class Eip155ChainId extends Eq {
    readonly namespace = "eip155" as const;
    constructor(readonly reference: number) { super(); }

    toString(): string {
        return `${this.namespace}:${this.reference}`;
    }
};
export class CustomChainId extends Eq {
    constructor(readonly namespace: string & {}, readonly reference: number) { super(); }

    toString(): string {
        return `${this.namespace}:${this.reference}`;
    }
};

/**
 * CAIP-19 Asset ID.
 * 
 * https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-19.md
 * 
 * - Slip44 assets represent native assets of blockchains (IE ETH on Ethereum,
 *   MATIC on Polygon).
 * - Erc20 assets represent fungible tokens.
 * - Erc721 assets represent non-fungible tokens.
 * 
 * @remarks Since on EVM chains the slip44 asset type is uniquely identified by 
 * the chain ID, the reference field is omitted for slip44 asset types.  Slip44
 * asset types always refer to the native asset of the chain.
 */
export type AssetId = Slip44AssetType | Erc20AssetType | Erc721AssetType;

/**
 * Chain-specific native asset type.
 */
export class Slip44AssetType extends Eq {
    readonly namespace = "slip44" as const;
    constructor(readonly chainId: ChainId) { super(); }

    toString(): string {
        return `${this.chainId.toString()}/${this.namespace}`;
    }
}

export class Erc20AssetType extends Eq {
    readonly namespace = "erc20" as const;
    constructor(readonly chainId: ChainId, readonly reference: Address) { super(); }

    toString(): string {
        return `${this.chainId.toString()}/${this.namespace}:${this.reference}`;
    }
}

export class Erc721AssetType extends Eq {
    readonly namespace = "erc721" as const;
    constructor(readonly chainId: ChainId, readonly reference: Address) { super(); }

    toString(): string {
        return `${this.chainId.toString()}/${this.namespace}:${this.reference}`;
    }
}

/**
 * CAIP-10 Account ID.
 * 
 * https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-10.md
 */
export class AccountId extends Eq {
    constructor(readonly chainId: ChainId, readonly accountId: string) { super(); }

    toString(): string {
        return `${this.chainId.toString()}/${this.accountId}`;
    }
}

export function chainId(namespace: 'eip155', reference: number): Eip155ChainId;
export function chainId(namespace: string & {}, reference: number): CustomChainId;
export function chainId(namespace: string, reference: number): Eip155ChainId | CustomChainId {
    if (namespace === "eip155") {
        return new Eip155ChainId(reference);
    } else {
        return new CustomChainId(namespace, reference);
    }
}

export function slip44(chainId: ChainId): Slip44AssetType {
    return new Slip44AssetType(chainId);
}

export function erc20(chainId: ChainId, address: Address): Erc20AssetType {
    return new Erc20AssetType(chainId, address);
}

export function erc721(chainId: ChainId, address: Address): Erc721AssetType {
    return new Erc721AssetType(chainId, address);
}
