import { Address, isAddress } from "viem";
import { InvalidAddressError, UnsupportedChainError } from "./errors";

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
export type ChainId =
    | { namespace: "eip155"; reference: number; }
    | { namespace: string & {}; reference: number; };

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
 * @remarks Consider breaking from caip-19 spec for slip44 to remove reference.
 * Since slip44 assets are uniquely identified by chain ID anyway, it's added
 * complexity without benefit.
 */
export interface AssetId {
    chainId: ChainId;
    assetType: { namespace: "slip44"; reference: number }
    | { namespace: "erc20"; reference: Address }
    | { namespace: "erc721"; reference: Address };
}

/**
 * CAIP-10 Account ID.
 * 
 * https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-10.md
 */
export interface AccountId {
    chainId: ChainId;
    accountId: string;
}

export function newEvmChainId(chainId: number): ChainId {
    return { namespace: "eip155", reference: chainId };
}

export function newEvmErc20(chainId: number, address: Address): AssetId {
    return {
        chainId: { namespace: "eip155", reference: chainId },
        assetType: { namespace: "erc20", reference: address },
    };
}

export function newEvmNative(chainId: number): AssetId {
    return {
        chainId: { namespace: "eip155", reference: chainId },
        assetType: { namespace: "slip44", reference: 60 },
    };
}

/**
 * Converts an AccountId to an EVM address.
 * 
 * @throws Error if the chain ID is not EVM or the account ID is not a valid EVM address.
 */
export function accountIdToAddress(accountId: AccountId): Address {
    if (accountId.chainId.namespace !== "eip155") {
        throw new UnsupportedChainError(accountId.chainId);
    }

    const address = accountId.accountId as Address;
    if (!isAddress(address)) {
        throw new InvalidAddressError(address);
    }
    return address;
}
