export async function loadCircuitFiles(circuitUrl: string, provingKeyUrl: string) {

  const [circuitRes, provingKeyRes] = await Promise.all([
    fetch(circuitUrl),
    fetch(provingKeyUrl),
  ]);

  const [circuitText, provingKey] = await Promise.all([
    circuitRes.text(),
    provingKeyRes.arrayBuffer(),
  ]);

  return { circuitText, provingKey };
}
