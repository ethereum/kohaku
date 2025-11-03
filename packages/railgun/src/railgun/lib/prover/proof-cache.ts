import { EngineDebug } from '../debugger/debugger';
import { Proof, UnprovedTransactionInputs } from '../models/prover-types';
import { stringifySafe } from '../utils/stringify';

export class ProofCache {
  private static cache: Map<string, Proof> = new Map();

  static get(transactionRequest: UnprovedTransactionInputs): Optional<Proof> {
    try {
      const stringified = stringifySafe(transactionRequest);

      return ProofCache.cache.get(stringified);
    } catch (err) {
      if (err instanceof Error) {
        EngineDebug.error(err);
      }

      return undefined;
    }
  }

  static store(transactionRequest: UnprovedTransactionInputs, proof: Proof) {
    try {
      const stringified = stringifySafe(transactionRequest);

      ProofCache.cache.set(stringified, proof);
    } catch (err) {
      if (err instanceof Error) {
        EngineDebug.error(err);
      }
    }
  }
}
