import { ITornadoArtifacts } from '../plugin/interfaces/protocol-params.interface';
import { assertTornadoArtifacts } from './artifacts-integrity';
import { ITornadoProver } from './tornado-prover';

export function makeLazyProverFactory(
  artifactsLoader: () => Promise<ITornadoArtifacts>,
): () => Promise<ITornadoProver> {
  let prover: ITornadoProver | null = null;

  return async () => {
    if (!prover) {
      const artifacts = await artifactsLoader();

      // Must run before JSON.parse: proving evaluates the circuit's template code.
      assertTornadoArtifacts(artifacts);

      const { circuitText, provingKey } = artifacts;
      const actualProverFactory = await import('./tornado-prover').then((m) => m.createTornadoProver);

      prover = await actualProverFactory(JSON.parse(circuitText), provingKey);
    }

    return prover;
  };
}
