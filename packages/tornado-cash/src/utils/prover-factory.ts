import { createTornadoProver, ITornadoProver } from './tornado-prover';
import { ITornadoArtifacts } from '../plugin/interfaces/protocol-params.interface';

export function makeLazyProverFactory(
  artifactsLoader: () => Promise<ITornadoArtifacts>
): () => Promise<ITornadoProver> {
  let prover: ITornadoProver | null = null;

  return async () => {
    if (!prover) {
      const { circuitText, provingKey } = await artifactsLoader();

      prover = await createTornadoProver(JSON.parse(circuitText), provingKey);
    }

    return prover;
  };
}
