import { TokenDataStructOutput } from '../abi/typechain/RailgunSmartWallet';
import { RailgunVersionedSmartContracts } from '../contracts/railgun-smart-wallet/railgun-versioned-smart-contracts';
import { Database } from '../database/database';
import { Chain } from '../models/engine-types';
import { TokenData } from '../models/formatted-types';
import { TXIDVersion } from '../models/poi-types';
import { getTokenDataERC20, serializeTokenData } from '../note/note-util';
import { ByteLength, ByteUtils } from '../utils';
import { fromUTF8String } from '../utils/bytes';

// 12 empty bytes.
const ERC20_TOKEN_HASH_PREFIX = '000000000000000000000000';

export class TokenDataGetter {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async getTokenDataFromHash(
    txidVersion: TXIDVersion,
    chain: Chain,
    tokenHash: string,
  ): Promise<TokenData> {
    const formatted = ByteUtils.formatToByteLength(tokenHash, ByteLength.UINT_256);
    const isERC20 = formatted.startsWith(ERC20_TOKEN_HASH_PREFIX);
    if (isERC20) {
      // tokenHash is erc20 tokenAddress.
      return getTokenDataERC20(tokenHash);
    }
    const tokenDataNFT = await this.getNFTTokenData(txidVersion, chain, tokenHash);
    return tokenDataNFT;
  }

  async getNFTTokenData(
    txidVersion: TXIDVersion,
    chain: Chain,
    tokenHash: string,
  ): Promise<TokenData> {
    const formattedTokenHash = ByteUtils.formatToByteLength(tokenHash, ByteLength.UINT_256, false);

    const cachedData = await this.getCachedNFTTokenData(formattedTokenHash);
    if (cachedData) {
      return cachedData;
    }

    const contractData = await RailgunVersionedSmartContracts.getNFTTokenData(
      txidVersion,
      chain,
      formattedTokenHash,
    );
    const tokenData = TokenDataGetter.structToTokenData(contractData);
    await this.cacheNFTTokenData(tokenHash, tokenData);
    return tokenData;
  }

  private static structToTokenData(struct: TokenDataStructOutput): TokenData {
    return serializeTokenData(struct.tokenAddress, struct.tokenType, struct.tokenSubID);
  }

  private static getNFTTokenDataPrefix(): string[] {
    const nftTokenDataPrefix = fromUTF8String('nft-token-data-map');
    return [nftTokenDataPrefix];
  }

  private static getNFTTokenDataPath(tokenHash: string): string[] {
    return [...TokenDataGetter.getNFTTokenDataPrefix(), tokenHash].map((el) =>
      ByteUtils.formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  private async cacheNFTTokenData(tokenHash: string, tokenData: TokenData): Promise<void> {
    await this.db.put(TokenDataGetter.getNFTTokenDataPath(tokenHash), tokenData, 'json');
  }

  async getCachedNFTTokenData(tokenHash: string): Promise<Optional<TokenData>> {
    try {
      const tokenData = (await this.db.get(
        TokenDataGetter.getNFTTokenDataPath(tokenHash),
        'json',
      )) as TokenData;
      return tokenData;
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Non-error thrown from getCachedNFTTokenData', { cause });
      }
      return undefined;
    }
  }
}
