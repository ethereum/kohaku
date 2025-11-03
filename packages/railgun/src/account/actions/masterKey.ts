export type GetMasterPublicKeyFn = () => Promise<bigint>;
export type GetMasterPublicKey = { getMasterPublicKey: GetMasterPublicKeyFn };
