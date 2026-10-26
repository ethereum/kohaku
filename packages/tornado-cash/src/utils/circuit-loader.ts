async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }

  return res;
}

export async function loadCircuitFiles(circuitUrl: string, provingKeyUrl: string) {

  const [circuitRes, provingKeyRes] = await Promise.all([
    fetchOk(circuitUrl),
    fetchOk(provingKeyUrl),
  ]);

  const [circuitText, provingKey] = await Promise.all([
    circuitRes.text(),
    provingKeyRes.arrayBuffer(),
  ]);

  return { circuitText, provingKey };
}
