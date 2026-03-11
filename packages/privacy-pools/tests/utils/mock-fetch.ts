/**
 * Mock fetch utilities for testing ASP services
 */

export interface MockFetchOptions {
  responses: Map<string, { json: unknown; status?: number }>;
  defaultError?: Error;
}

/**
 * Creates a mock fetch function that returns predefined responses based on URL
 */
export function createMockFetch(options: MockFetchOptions): typeof fetch {
  const { responses, defaultError } = options;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    // Check if we have a matching response
    for (const [pattern, response] of responses) {
      if (url.includes(pattern)) {
        return {
          ok: (response.status ?? 200) >= 200 && (response.status ?? 200) < 300,
          status: response.status ?? 200,
          json: async () => response.json,
          text: async () => JSON.stringify(response.json),
          headers: new Headers(),
        } as Response;
      }
    }

    if (defaultError) {
      throw defaultError;
    }

    throw new Error(`No mock response for URL: ${url}`);
  };
}

/**
 * Creates a mock fetch that tracks all calls made to it
 */
export interface TrackedMockFetch {
  fetch: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
  clear: () => void;
}

export function createTrackedMockFetch(options: MockFetchOptions): TrackedMockFetch {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    calls.push({ url, init });

    const baseFetch = createMockFetch(options);

    return baseFetch(input, init);
  };

  return {
    fetch: fetch as typeof globalThis.fetch,
    calls,
    clear: () => {
      calls.length = 0;
    },
  };
}

/**
 * Creates a mock fetch that always fails with the given error
 */
export function createFailingFetch(error: Error): typeof fetch {
  return async (): Promise<Response> => {
    throw error;
  };
}
