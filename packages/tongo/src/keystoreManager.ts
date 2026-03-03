import { Host } from "@kohaku-eth/plugins";

export interface IKeystoreManager {
  deriveKey: () => bigint;
}

export interface KeystoreManagerParams {
  host: Host;
}
export interface IKeystoreManagerFactory {
  (params: KeystoreManagerParams): IKeystoreManager;
}

export const KeystoreManagerFactory = (params: KeystoreManagerParams): IKeystoreManager => {
  const { host: { keystore } } = params;

  const BN254_GROUP_ORDER = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

  const deriveKey = () => {
    const accountIndex = "0";
    const derivation = BigInt(keystore.deriveAt("m/701160/"/*TONGO*/ + accountIndex));
    return derivation % BN254_GROUP_ORDER;
  };

  return {
    deriveKey
  };
};
