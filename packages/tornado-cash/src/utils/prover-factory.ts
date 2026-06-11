import { ITornadoArtifacts } from '../plugin/interfaces/protocol-params.interface';
import { ITornadoProver } from './tornado-prover';

export function makeLazyProverFactory(
  artifactsLoader: () => Promise<ITornadoArtifacts>,
  version: 'legacy' | 'js' = 'legacy'
): () => Promise<ITornadoProver> {
  let prover: ITornadoProver | null = null;

  return async () => {
    if (!prover) {
      const { circuitText, provingKey } = await artifactsLoader();

      const actualProverFactory = await (version === 'js' ?
        import('./tornado-prover-v2').then((m) => m.createTornadoProver) :
        import('./tornado-prover').then((m) => m.createTornadoProver));

      prover = await actualProverFactory(JSON.parse(circuitText), provingKey);
    }

    return prover;
  };
}
