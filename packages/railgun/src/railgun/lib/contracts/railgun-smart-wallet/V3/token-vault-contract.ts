import { Contract, FallbackProvider } from "ethers";
import {
  TokenDataStructOutput,
  TokenVault,
} from "../../../abi/typechain/TokenVault";
import { PollingJsonRpcProvider } from "../../../provider/polling-json-rpc-provider";
import { ABITokenVault } from "../../../abi/abi";
import { ByteLength, ByteUtils } from "../../../utils/bytes";
import { EngineDebug } from "../../../debugger/debugger";

export class TokenVaultContract {
  readonly contract: TokenVault;

  readonly address: string;

  constructor(
    address: string,
    provider: PollingJsonRpcProvider | FallbackProvider
  ) {
    this.address = address;
    this.contract = new Contract(
      address,
      ABITokenVault,
      provider
    ) as unknown as TokenVault;
  }

  /**
   * Gets transaction fees in basis points.
   */
  async fees(): Promise<{
    shield: bigint;
    unshield: bigint;
  }> {
    const [shieldFee, unshieldFee] = await Promise.all([
      this.contract.shieldFee(),
      this.contract.unshieldFee(),
    ]);

    return {
      shield: shieldFee,
      unshield: unshieldFee,
    };
  }

  /**
   * Gets NFT token data from tokenHash.
   */
  async getNFTTokenData(tokenHash: string): Promise<TokenDataStructOutput> {
    try {
      const formattedTokenHash = ByteUtils.formatToByteLength(
        tokenHash,
        ByteLength.UINT_256,
        true
      );

      return await this.contract.tokenIDMapping(formattedTokenHash);
    } catch (cause) {
      const err = new Error("Failed to get V3 NFT token data", { cause });

      EngineDebug.error(err);
      throw err;
    }
  }
}
