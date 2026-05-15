import { createTornadoProver, ITornadoProver } from './tornado-prover';
import { loadCircuitFiles } from '#circuit-loader';

export function makeLazyProverFactory(
  circuitUrl?: string,
  provingKeyUrl?: string,
): () => Promise<ITornadoProver> {
  let prover: ITornadoProver | null = null;

  return async () => {
    if (!prover) {
      const { circuitText, provingKey } = await loadCircuitFiles(circuitUrl, provingKeyUrl);

      prover = await createTornadoProver(JSON.parse(circuitText), provingKey);
    }

    return prover;
  };
}
