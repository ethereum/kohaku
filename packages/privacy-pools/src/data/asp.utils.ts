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
