import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {
  childKeyDerivationHardened,
  getMasterKeyFromSeed,
  getPathSegments,
} from "../bip32";

chai.use(chaiAsPromised);
const { expect } = chai;

describe("bip32-babyjubjub", () => {
  it("Should derive master key", () => {
    const vectors = [
      {
        seed: "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4",
        chainCode:
          "30d550bc2f61a7c206a1eba3704502da77f366fe69721265b3b7e2c7f05eeabc",
        chainKey:
          "1fafc64161d1807e294cc9fded180ca2009aaaedf4cbd7359d4aaa3bb462f411",
      },
      {
        seed: "d8c228addf9a9cfe5b7934223737815e2f709b3ac12b0c1b2aaec921e5d3a2e8aeea1df817af8159f981798dacd5a930a1fcd8570ba4845078c1b1d09fa060cb",
        chainCode:
          "b37268d31994f4bbe422feffb3e1dcb35b61b76c0c1ebea2ded5fb0e37aa0809",
        chainKey:
          "c544e07e1007d25b6a3a7ddba8f1e20c2c23c9baec8e9a6200dd6c3b2f8df6a5",
      },
      {
        seed: "243c1266228fc9ff370d567ba4f805dfacc516375aecf4657cf870a4b551020d92d9b45a8181154f531c1358f742f42078a1620fca6251b1c4ec5fa6e1cf5c3a",
        chainCode:
          "8bf4df70930efcf3ce0e8501464891837fa591b3b0924d9110b18152b8a85d37",
        chainKey:
          "73eb04585b9ecc409c76a2949f099193be82198eb6abab1594be4138070f19d6",
      },
      {
        seed: "87ec3e2ae9294cb5500698e6e6ee8357aa56222badae0e6b4150492c95ede7ddfca27c952afafb388453def93fac72f5d7e099debd79e85c2088f9b3e7a65df6",
        chainCode:
          "5a7496d62dab5d3bef668bcff39eef421ea6b9544dba30805858989dc6611e36",
        chainKey:
          "5c8f71501f449b499feddb89d865f15d35d24586b6447b7c9b7385d0bf217fd4",
      },
    ];

    for (const vector of vectors) {
      const masterKey = getMasterKeyFromSeed(vector.seed);

      expect(masterKey.chainCode).to.equal(vector.chainCode);
      expect(masterKey.chainKey).to.equal(vector.chainKey);
    }
  });

  it("Should derive child keys directly", () => {
    const vectors = [
      {
        parent: {
          chainCode:
            "30d550bc2f61a7c206a1eba3704502da77f366fe69721265b3b7e2c7f05eeabc",
          chainKey:
            "1fafc64161d1807e294cc9fded180ca2009aaaedf4cbd7359d4aaa3bb462f411",
        },
        index: 0,
        child: {
          chainCode:
            "e8e6a1bbce8bab145fe8225435dc98d20d53bd32318ce3ede560b8feef3394a5",
          chainKey:
            "67d7d19d00e6e3b3517fe68ac46505dd207df6e8fe3aa06ba3face352e7599ef",
        },
      },
      {
        parent: {
          chainCode:
            "30d550bc2f61a7c206a1eba3704502da77f366fe69721265b3b7e2c7f05eeabc",
          chainKey:
            "1fafc64161d1807e294cc9fded180ca2009aaaedf4cbd7359d4aaa3bb462f411",
        },
        index: 12,
        child: {
          chainCode:
            "ff90a1dcb6531d437dc959b6e03f308dd4d9db7e489bdb30d8b4b1894a9e1344",
          chainKey:
            "9606ae0c844601e0af4d518dce577983ad756dea08726d92c080ed2ca3f5f31d",
        },
      },
      {
        parent: {
          chainCode:
            "b37268d31994f4bbe422feffb3e1dcb35b61b76c0c1ebea2ded5fb0e37aa0809",
          chainKey:
            "c544e07e1007d25b6a3a7ddba8f1e20c2c23c9baec8e9a6200dd6c3b2f8df6a5",
        },
        index: 1,
        child: {
          chainCode:
            "30c3769638ef70c9179a7b18a507318d2353831c2d7990056334cbf14ed4a2cf",
          chainKey:
            "0b20d68e515add21c2686d88b8ae02d82912741ed66cb776b6a2eec628ce5fef",
        },
      },
    ];

    for (const vector of vectors) {
      expect(
        childKeyDerivationHardened(vector.parent, vector.index)
      ).to.deep.equal(vector.child);
    }
  });

  it("Should parse path segments", () => {
    const valid = [
      {
        path: "m/0'/1'/1'",
        segments: [0, 1, 1],
      },
      {
        path: "m/12'/0'/15'",
        segments: [12, 0, 15],
      },
      {
        path: "m/1'/91'/12'",
        segments: [1, 91, 12],
      },
    ];

    const invalid = ["m/0/0", "railgun", "m/0'/0'/x"];

    for (const vector of valid) {
      expect(getPathSegments(vector.path)).to.deep.equal(vector.segments);
    }

    for (const vector of invalid) {
      expect(() => getPathSegments(vector)).to.throw("Invalid derivation path");
    }
  });
});
