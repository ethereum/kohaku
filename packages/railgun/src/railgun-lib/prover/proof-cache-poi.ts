import EngineDebug from '../debugger/debugger';
import { Proof } from '../models/prover-types';
import { stringifySafe } from '../utils/stringify';

export class ProofCachePOI {
  private static cache: Map<string, Proof> = new Map();

  static get(
    listKey: string,
    anyRailgunTxidMerklerootAfterTransaction: string,
    blindedCommitmentsOut: string[],
    poiMerkleroots: string[],
    railgunTxidIfHasUnshield: string,
  ): Optional<Proof> {
    try {
      const stringified = stringifySafe([
        listKey,
        anyRailgunTxidMerklerootAfterTransaction,
        ...blindedCommitmentsOut,
        ...poiMerkleroots,
        railgunTxidIfHasUnshield,
      ]);
      return ProofCachePOI.cache.get(stringified);
    } catch (err) {
      if (err instanceof Error) {
        EngineDebug.error(err);
      }
      return undefined;
    }
  }

  static store(
    listKey: string,
    anyRailgunTxidMerklerootAfterTransaction: string,
    blindedCommitmentsOut: string[],
    poiMerkleroots: string[],
    railgunTxidIfHasUnshield: string,
    proof: Proof,
  ) {
    try {
      const stringified = stringifySafe([
        listKey,
        anyRailgunTxidMerklerootAfterTransaction,
        ...blindedCommitmentsOut,
        ...poiMerkleroots,
        railgunTxidIfHasUnshield,
      ]);
      ProofCachePOI.cache.set(stringified, proof);
    } catch (err) {
      if (err instanceof Error) {
        EngineDebug.error(err);
      }
    }
  }

  static clear_TEST_ONLY() {
    ProofCachePOI.cache.clear();
  }
}
