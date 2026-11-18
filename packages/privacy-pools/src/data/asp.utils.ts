// Client work budgets, not protocol tree capacity.
export const MAX_ASP_LEAVES = 100_000;
const MAX_ASP_BYTES = 16 * 1024 * 1024;

export async function readAspJson(response: Response): Promise<unknown> {
  let bytes = 0;
  const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;

      if (bytes > MAX_ASP_BYTES) throw new Error('ASP response exceeds 16 MiB');

      controller.enqueue(chunk);
    },
  }));
  // Hosts without streaming responses can only be checked after reading the text.
  const text = await (body ? new Response(body) : response).text();

  if (text.length > MAX_ASP_BYTES || (!body && new TextEncoder().encode(text).byteLength > MAX_ASP_BYTES)) {
    throw new Error('ASP response exceeds 16 MiB');
  }

  return JSON.parse(text);
}

export function parseAspLeaves(leaves: unknown): bigint[] {
  if (
    !Array.isArray(leaves) || leaves.length > MAX_ASP_LEAVES ||
    leaves.some((leaf) => typeof leaf !== 'string' || leaf.length > 78)
  ) {
    throw new Error('Unexpected response: ASP tree exceeds client limits or contains invalid leaves');
  }

  return leaves.map(BigInt);
}
