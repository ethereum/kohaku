import chai from "chai";
import chaiAsPromised from "chai-as-promised";

import { Mnemonic } from "../bip39";

chai.use(chaiAsPromised);
const { expect } = chai;

describe("bip39", () => {
  it("Should generate mnemonic", () => {
    expect(Mnemonic.generate().split(" ").length).to.equal(12);
    expect(Mnemonic.generate(192).split(" ").length).to.equal(18);
    expect(Mnemonic.generate(256).split(" ").length).to.equal(24);

    // Should only have letters and spaces
    expect(/^[a-z ]+$/.test(Mnemonic.generate())).to.equal(true);
  });

  it("Should convert mnemonic to entropy and back", () => {
    const vectors = [
      {
        mnemonic:
          "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        entropy: "00000000000000000000000000000000",
      },
      {
        mnemonic:
          "mammal step public march absorb critic visa rent miss color erase exhaust south lift ordinary ceiling stay physical",
        entropy: "86baaeb443e00c67bd2db28dc5b531a7bd0302e71127d4f4",
      },
      {
        mnemonic:
          "culture flower sunny seat maximum begin design magnet side permit coin dial alter insect whisper series desk power cream afford regular strike poem ostrich",
        entropy:
          "358b3365e12896288ef42fc7f464b59e8076ea3ea6203bf528cb823b4dae29c4",
      },
    ];

    for (const vector of vectors) {
      expect(Mnemonic.toEntropy(vector.mnemonic)).to.equal(vector.entropy);
      expect(Mnemonic.fromEntropy(vector.entropy)).to.equal(vector.mnemonic);
    }
  });

  it("Should validate mnemonics", async () => {
    const valid = [
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      "mammal step public march absorb critic visa rent miss color erase exhaust south lift ordinary ceiling stay physical",
      "culture flower sunny seat maximum begin design magnet side permit coin dial alter insect whisper series desk power cream afford regular strike poem ostrich",
    ];

    const invalid = [
      "Why, sometimes I've believed as many as six impossible things before breakfast.",
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon",
      "chicken",
    ];

    for (const vector of valid) {
      expect(Mnemonic.validate(vector)).to.equal(true);
    }

    for (const vector of invalid) {
      expect(Mnemonic.validate(vector)).to.equal(false);
    }
  });

  it("Should convert mnemonic to seed", async () => {
    const vectors = [
      {
        mnemonic:
          "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        seed: "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4",
      },
      {
        mnemonic:
          "mammal step public march absorb critic visa rent miss color erase exhaust south lift ordinary ceiling stay physical",
        seed: "d8c228addf9a9cfe5b7934223737815e2f709b3ac12b0c1b2aaec921e5d3a2e8aeea1df817af8159f981798dacd5a930a1fcd8570ba4845078c1b1d09fa060cb",
      },
      {
        mnemonic:
          "culture flower sunny seat maximum begin design magnet side permit coin dial alter insect whisper series desk power cream afford regular strike poem ostrich",
        seed: "243c1266228fc9ff370d567ba4f805dfacc516375aecf4657cf870a4b551020d92d9b45a8181154f531c1358f742f42078a1620fca6251b1c4ec5fa6e1cf5c3a",
      },
      {
        mnemonic:
          "culture flower sunny seat maximum begin design magnet side permit coin dial alter insect whisper series desk power cream afford regular strike poem ostrich",
        password: "test",
        seed: "87ec3e2ae9294cb5500698e6e6ee8357aa56222badae0e6b4150492c95ede7ddfca27c952afafb388453def93fac72f5d7e099debd79e85c2088f9b3e7a65df6",
      },
    ];

    for (const vector of vectors) {
      expect(Mnemonic.toSeed(vector.mnemonic, vector.password)).to.equal(
        vector.seed
      );
    }
  });
});
