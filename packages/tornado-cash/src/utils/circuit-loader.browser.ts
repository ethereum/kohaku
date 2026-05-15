export async function loadCircuitFiles(circuitUrl?: string, provingKeyUrl?: string) {
  if (!circuitUrl || !provingKeyUrl) {
    throw new Error('Missing circuits urls. Circuits must be provided to run in the browser.');
  }

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
