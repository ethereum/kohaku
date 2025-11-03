import { Chain } from "../models/engine-types";
import { ByteLength, ByteUtils } from "../utils/bytes";

const chainsSupportingV3: Chain[] = [];

const getChainFullNetworkID = (chain: Chain): string => {
  // 1 byte: chainType.
  const formattedChainType = ByteUtils.formatToByteLength(
    ByteUtils.hexlify(chain.type),
    ByteLength.UINT_8
  );
  // 7 bytes: chainID.
  const formattedChainID = ByteUtils.formatToByteLength(
    ByteUtils.hexlify(chain.chainId),
    ByteLength.UINT_56
  );

  return `${formattedChainType}${formattedChainID}`;
};

export const getChainSupportsV3 = (chain: Chain): boolean => {
  for (const supportingV3Chain of chainsSupportingV3) {
    if (
      chain.chainId === supportingV3Chain.chainId &&
      chain.type === supportingV3Chain.type
    ) {
      return true;
    }
  }

  return false;
};

export const assertChainSupportsV3 = (chain: Chain) => {
  if (!getChainSupportsV3(chain)) {
    throw new Error(
      `Chain does not support V3: ${chain.type}:${chain.chainId}. Set supportsV3 'true' in loadNetwork.`
    );
  }
};

export const addChainSupportsV3 = (chain: Chain) => {
  chainsSupportingV3.push(chain);
};

export { getChainFullNetworkID };
