import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { WalletInfo } from "../wallet-info";

chai.use(chaiAsPromised);
const { expect } = chai;

describe("wallet-info", () => {
  it("Should encode and decode wallet source", async () => {
    const walletSource = "New Wallet";

    WalletInfo.setWalletSource(walletSource);
    const encoded = WalletInfo.getEncodedWalletSource(walletSource);

    expect(WalletInfo.walletSource).to.equal("new wallet");
    expect(WalletInfo.decodeWalletSource(encoded)).to.equal("new wallet");
  });

  it("Should fail for invalid wallet source", async () => {
    const walletSource = "!@#$%";

    expect(() => WalletInfo.setWalletSource(walletSource)).to.throw();
  });
});
