import { poseidon } from "../utils/poseidon";
import { NFTTokenData, TokenData, TokenType } from "../models/formatted-types";
import { UnshieldStoredEvent } from "../models/event-types";
import { TOKEN_SUB_ID_NULL } from "../models/transaction-constants";
import { SNARK_PRIME } from "../utils/constants";
import { ByteLength, ByteUtils } from "../utils/bytes";
import { keccak256 } from "../utils/hash";
import { CommitmentPreimageStructOutput } from "../abi/typechain/PoseidonMerkleAccumulator";
import { isDefined } from "../utils/is-defined";

export const ERC721_NOTE_VALUE = BigInt(1);

export const assertValidNoteToken = (tokenData: TokenData, value: bigint) => {
  const tokenAddressLength = ByteUtils.hexlify(
    tokenData.tokenAddress,
    false
  ).length;

  switch (tokenData.tokenType) {
    case TokenType.ERC20: {
      if (tokenAddressLength !== 40 && tokenAddressLength !== 64) {
        throw new Error(
          `ERC20 address must be length 40 (20 bytes) or 64 (32 bytes). Got ${ByteUtils.hexlify(
            tokenData.tokenAddress,
            false
          )}.`
        );
      }

      if (BigInt(tokenData.tokenSubID) !== 0n) {
        throw new Error("ERC20 note cannot have tokenSubID parameter.");
      }

      return;
    }
    case TokenType.ERC721: {
      if (tokenAddressLength !== 40) {
        throw new Error(
          `ERC721 address must be length 40 (20 bytes). Got ${ByteUtils.hexlify(
            tokenData.tokenAddress,
            false
          )}.`
        );
      }

      if (!tokenData.tokenSubID.length) {
        throw new Error("ERC721 note must have tokenSubID parameter.");
      }

      if (value !== BigInt(1)) {
        throw new Error("ERC721 note must have value of 1.");
      }

      return;
    }
    case TokenType.ERC1155: {
      if (tokenAddressLength !== 40) {
        throw new Error(
          `ERC1155 address must be length 40 (20 bytes). Got ${ByteUtils.hexlify(
            tokenData.tokenAddress,
            false
          )}.`
        );
      }

      if (!tokenData.tokenSubID.length) {
        throw new Error("ERC1155 note must have tokenSubID parameter.");
      }
    }
  }
};

export const assertValidNoteRandom = (random: string) => {
  if (ByteUtils.hexlify(random, false).length !== 32) {
    throw new Error(
      `Random must be length 32 (16 bytes). Got ${ByteUtils.hexlify(
        random,
        false
      )}.`
    );
  }
};

export const serializePreImage = (
  address: string,
  tokenData: TokenData,
  value: bigint,
  prefix: boolean = false
) => {
  return {
    npk: ByteUtils.formatToByteLength(address, ByteLength.UINT_256, prefix),
    token: tokenData,
    value: formatValue(value, prefix),
  };
};

export const extractTokenHashFromCommitmentPreImageV3 = (
  preimage: CommitmentPreimageStructOutput
): string => {
  if (!isDefined(preimage)) {
    throw new Error("Invalid preimage.");
  }

  const tokenData = serializeTokenData(
    preimage.token.tokenAddress,
    preimage.token.tokenType,
    preimage.token.tokenSubID.toString()
  );
  const tokenHash = getTokenDataHash(tokenData);

  return tokenHash;
};

export const serializeTokenData = (
  tokenAddress: string,
  tokenType: bigint | TokenType,
  tokenSubID: bigint | string
): TokenData => {
  return {
    tokenAddress: ByteUtils.formatToByteLength(
      tokenAddress,
      ByteLength.Address,
      true
    ),
    tokenType: Number(tokenType),
    tokenSubID: ByteUtils.nToHex(BigInt(tokenSubID), ByteLength.UINT_256, true),
  };
};

const formatValue = (value: bigint, prefix: boolean = false): string => {
  return ByteUtils.nToHex(value, ByteLength.UINT_128, prefix);
};

export const getNoteHash = (
  address: string,
  tokenData: TokenData,
  value: bigint
): bigint => {
  const tokenHash = getTokenDataHash(tokenData);

  return poseidon([
    ByteUtils.hexToBigInt(address),
    ByteUtils.hexToBigInt(tokenHash),
    value,
  ]);
};

export const getUnshieldEventNoteHash = (
  unshieldEvent: UnshieldStoredEvent
): bigint => {
  return getNoteHash(
    unshieldEvent.toAddress,
    getUnshieldTokenData(unshieldEvent),
    BigInt(unshieldEvent.amount) + BigInt(unshieldEvent.fee)
  );
};

export const getUnshieldPreImageNoteHash = (
  unshieldPreimage: CommitmentPreimageStructOutput
): bigint => {
  return getNoteHash(
    unshieldPreimage.npk,
    serializeTokenData(
      unshieldPreimage.token.tokenAddress,
      unshieldPreimage.token.tokenType,
      unshieldPreimage.token.tokenSubID.toString()
    ),
    unshieldPreimage.value
  );
};

const getUnshieldTokenData = (
  unshieldEvent: UnshieldStoredEvent
): TokenData => {
  return serializeTokenData(
    unshieldEvent.tokenAddress,
    unshieldEvent.tokenType,
    unshieldEvent.tokenSubID
  );
};

export const getUnshieldTokenHash = (
  unshieldEvent: UnshieldStoredEvent
): string => {
  return getTokenDataHash(getUnshieldTokenData(unshieldEvent));
};

export const getTokenDataHashERC20 = (tokenAddress: string): string => {
  return ByteUtils.formatToByteLength(
    ByteUtils.hexToBytes(tokenAddress),
    ByteLength.UINT_256
  );
};

const getTokenDataHashNFT = (tokenData: TokenData): string => {
  // keccak256 hash of the token data.
  const combinedData: string = ByteUtils.combine([
    ByteUtils.nToBytes(BigInt(tokenData.tokenType), ByteLength.UINT_256),
    ByteUtils.hexToBytes(
      ByteUtils.formatToByteLength(tokenData.tokenAddress, ByteLength.UINT_256)
    ),
    ByteUtils.nToBytes(BigInt(tokenData.tokenSubID), ByteLength.UINT_256),
  ]);
  const hashed: string = keccak256(combinedData);
  const modulo: bigint = ByteUtils.hexToBigInt(hashed) % SNARK_PRIME;

  return ByteUtils.nToHex(modulo, ByteLength.UINT_256);
};

export const getTokenDataERC20 = (tokenAddress: string): TokenData => {
  return {
    tokenAddress: ByteUtils.formatToByteLength(
      tokenAddress,
      ByteLength.Address,
      true
    ),
    tokenType: TokenType.ERC20,
    tokenSubID: ByteUtils.formatToByteLength(
      TOKEN_SUB_ID_NULL,
      ByteLength.UINT_256,
      true
    ),
  };
};

export const getTokenDataNFT = (
  nftAddress: string,
  tokenType: TokenType.ERC721 | TokenType.ERC1155,
  tokenSubID: string
): NFTTokenData => {
  return {
    tokenAddress: ByteUtils.formatToByteLength(
      nftAddress,
      ByteLength.Address,
      true
    ),
    tokenType,
    tokenSubID: ByteUtils.formatToByteLength(
      tokenSubID,
      ByteLength.UINT_256,
      true
    ),
  };
};

export const getTokenDataHash = (tokenData: TokenData): string => {
  switch (tokenData.tokenType) {
    case TokenType.ERC20:
      return getTokenDataHashERC20(tokenData.tokenAddress);
    case TokenType.ERC721:
    case TokenType.ERC1155:
      return getTokenDataHashNFT(tokenData);
  }

  throw new Error("Unrecognized token type.");
};

export const getReadableTokenAddress = (tokenData: TokenData): string => {
  switch (tokenData.tokenType) {
    case TokenType.ERC20:
      return `0x${
        ByteUtils.trim(tokenData.tokenAddress, ByteLength.Address) as string
      }`;
    case TokenType.ERC721:
    case TokenType.ERC1155:
      return `${tokenData.tokenAddress} (${tokenData.tokenSubID})`;
  }

  throw new Error("Unrecognized token type.");
};
