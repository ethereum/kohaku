import { UnsupportedAssetError, type AssetAmount, type AssetId, type ERC20AssetId } from "@kohaku-eth/plugins";
import { E_ADDRESS } from "../config";
import { VALUE_LIMIT } from "../crypto/params";

export const ETH: ERC20AssetId = { __type: "erc20", contract: E_ADDRESS };

export const isEth = (asset: AssetId): boolean =>
  asset.__type === "native" || (asset.__type === "erc20" && asset.contract.toLowerCase() === E_ADDRESS);

export function ethAmount(input: AssetAmount): bigint {
  if (!isEth(input.asset)) throw new UnsupportedAssetError(input.asset);

  if (input.amount <= 0n || input.amount >= VALUE_LIMIT) throw new RangeError("tacit: the amount must be above 0 and below 2^120 wei");

  return input.amount;
}

