import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { TokenData, TokenType } from "../../models/formatted-types";
import { ByteLength, ByteUtils } from "../../utils";
import { getTokenDataHash } from "../note-util";

chai.use(chaiAsPromised);
const { expect } = chai;

describe("note-util", () => {
  it("Should get token data hash for various token types", async () => {
    const tokenDataERC20: TokenData = {
      tokenAddress: "0x1234567890123456789012345678901234567890",
      tokenSubID: BigInt(1).toString(),
      tokenType: TokenType.ERC20,
    };

    expect(getTokenDataHash(tokenDataERC20)).to.equal(
      ByteUtils.formatToByteLength(
        tokenDataERC20.tokenAddress,
        ByteLength.UINT_256
      )
    );

    const tokenDataERC721: TokenData = {
      ...tokenDataERC20,
      tokenType: TokenType.ERC721,
    };

    expect(getTokenDataHash(tokenDataERC721)).to.equal(
      "075b737079de804169d5e006add4da4942063ab4fce32268c469c49460e52be0"
    );

    const tokenDataERC1155: TokenData = {
      ...tokenDataERC20,
      tokenType: TokenType.ERC1155,
    };

    expect(getTokenDataHash(tokenDataERC1155)).to.equal(
      "2d0c48e5b759b13bea21d65719c47747f857f47be541ddb0df54fa0a040a7bed"
    );
  });
});
