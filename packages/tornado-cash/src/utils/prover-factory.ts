import { createTornadoProver, ITornadoProver } from './tornado-prover';

export function makeLazyProverFactory(
  circuitUrl: string,
  provingKeyUrl: string,
): () => Promise<ITornadoProver> {
  let prover: ITornadoProver | null = null;

  return async () => {
    if (!prover) {
      const [circuitRes, provingKeyRes] = await Promise.all([
        fetch(circuitUrl),
        fetch(provingKeyUrl),
      ]);

      const [circuitText, provingKey] = await Promise.all([
        circuitRes.text(),
        provingKeyRes.arrayBuffer(),
      ]);

      prover = await createTornadoProver(JSON.parse(circuitText), provingKey);
    }

    return prover;
  };
}
