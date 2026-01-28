import { Address } from "viem";
import { AccountId, AssetId } from "./types";
import { TxData } from "@kohaku-eth/provider";

/**
 * Shield preparation result containing the necessary transaction data.
 */
export interface ShieldPreparation {
    /**
     * Array of transaction data required to perform the shield operation.
     */
    txns: Array<TxData>;
}

export interface Operation {
    inner: unknown;
}

export type AssetAmount = {
    asset: AssetId;
    amount: bigint;
};

/**
 * Plugin interface implemented by all privacy pool plugins.
 */
export interface Plugin {
    /**
     * Retrieve the account ID associated with this plugin.
     */
    account(): Promise<AccountId>;

    /**
     * Retrieve the current balance of the specified assets.
     * @param assets The asset(s) to check the balance for. If undefined, 
     * retrieves the balance for all supported assets.
     * 
     * @throws {Error} If unable to retrieve the balance.
     */
    balance(assets: Array<AssetId> | undefined): Promise<Array<AssetAmount>>;

    /**
     * Prepares a shield operation for the specified asset(s).
     * @param assets The asset(s) to be shielded.
     * @param from The address from which the assets will be shielded. If provided, 
     * the plugin may use this information to optimize the shielding process.
     * 
     * @throws {UnsupportedAssetError} If any of the specified assets are not supported by the plugin.
     * @throws {MultiAssetsNotSupportedError} If the plugin does not support shielding multiple assets at once.
     * @throws {Error} If the shield operation could not be prepared.
     */
    prepareShield(assets: Array<AssetAmount> | AssetAmount, from?: Address): Promise<ShieldPreparation>;

    /**
     * Prepares an unshield operation for the specified asset(s).
     * @param assets The asset(s) to be unshielded.
     * @param to The address to which the assets will be unshielded.
     * 
     * @throws {UnsupportedAssetError} If any of the specified assets are not supported by the plugin.
     * @throws {MultiAssetsNotSupportedError} If the plugin does not support unshielding multiple assets at once.
     * @throws {InsufficientBalanceError} If there is insufficient balance for any of the specified assets.
     * @throws {Error} If the unshield operation could not be prepared.
     */
    prepareUnshield(assets: Array<AssetAmount> | AssetAmount, to: Address): Promise<Operation>;

    /**
     * Prepares a transfer operation for the specified asset(s).
     * @param assets The asset(s) to be transferred.
     * @param to The account to which the assets will be transferred.

     * @throws {UnsupportedAssetError} If any of the specified assets are not supported by the plugin.
     * @throws {MultiAssetsNotSupportedError} If the plugin does not support transferring multiple assets at once.
     * @throws {InsufficientBalanceError} If there is insufficient balance for any of the specified assets.
     * @throws {Error} If the transfer operation could not be prepared.
     */
    prepareTransfer(assets: Array<AssetAmount> | AssetAmount, to: AccountId): Promise<Operation>;

    /**
     * Broadcasts the specified operation to the network.
     * @param operation The operation to be broadcasted.
     * 
     * @throws {Error} If the operation could not be broadcasted.
     */
    broadcast(operation: Operation): Promise<void>;
}
