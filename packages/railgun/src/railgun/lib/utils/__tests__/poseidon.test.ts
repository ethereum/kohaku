import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { initPoseidonPromise, poseidon, poseidonHex } from "../poseidon";

chai.use(chaiAsPromised);
const { expect } = chai;

describe("poseidon", () => {
  it("works with bigInt inputs", async () => {
    await initPoseidonPromise;
    const left = 0n;
    const right = 1n;

    expect(poseidon([left, right])).to.equal(
      12583541437132735734108669866114103169564651237895298778035846191048104863326n
    );
  });

  describe("poseidonHex", () => {
    it("works with hex inputs", async () => {
      await initPoseidonPromise;
      const left = "0";
      const right = "1";

      expect(poseidonHex([left, right])).to.equal(
        "1bd20834f5de9830c643778a2e88a3a1363c8b9ac083d36d75bf87c49953e65e"
      );
    });

    it("works with byte inputs", async () => {
      await initPoseidonPromise;
      const left = "00";
      const right = "01";

      expect(poseidonHex([left, right])).to.equal(
        "1bd20834f5de9830c643778a2e88a3a1363c8b9ac083d36d75bf87c49953e65e"
      );
    });

    it("works with 0x-prefixed hex inputs", async () => {
      await initPoseidonPromise;
      const left = "0x0";
      const right = "0x1";

      expect(poseidonHex([left, right])).to.equal(
        "1bd20834f5de9830c643778a2e88a3a1363c8b9ac083d36d75bf87c49953e65e"
      );
    });
  });
});
