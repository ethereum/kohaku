import type { Network } from "@kohaku-eth/plugins";
import type { HTTPRequestOptions, IHTTPClient } from "@0xbow-io/privacy-pools-v2-sdk";

/**
 * Adapts the Kohaku {@link Network} (`fetch`) onto the SDK's {@link IHTTPClient}
 * (`get`/`post`/`getBinary`), so all ASP, relayer and artifact traffic routes
 * through the wallet's own network stack. JSON in/out for get/post, raw bytes for
 * `getBinary` (circuit artifacts).
 */
export class KohakuHttpClient implements IHTTPClient {
    /** @param network - the wallet's network stack (all traffic routes through it). */
    constructor(private readonly network: Network) {}

    /** GET returning parsed JSON. */
    async get<T>(url: string, options?: HTTPRequestOptions): Promise<T> {
        const res = await this.request(url, { method: "GET" }, options);

        return (await res.json()) as T;
    }

    /** POST a JSON body, returning parsed JSON. */
    async post<T>(url: string, body: unknown, options?: HTTPRequestOptions): Promise<T> {
        const res = await this.request(
            url,
            {
                method: "POST",
                body: JSON.stringify(body),
                headers: { "content-type": "application/json" },
            },
            options,
        );

        return (await res.json()) as T;
    }

    /** GET returning raw bytes (circuit artifacts). */
    async getBinary(url: string, options?: HTTPRequestOptions): Promise<Uint8Array> {
        const res = await this.request(url, { method: "GET" }, options);

        return new Uint8Array(await res.arrayBuffer());
    }

    /** Shared fetch path: merge headers, apply signal/timeout, throw on non-2xx. */
    private async request(
        url: string,
        init: RequestInit,
        options?: HTTPRequestOptions,
    ): Promise<Response> {
        const headers = { ...(init.headers as Record<string, string>), ...options?.headers };
        const res = await this.network.fetch(url, {
            ...init,
            headers,
            signal: this.resolveSignal(options),
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
        }

        return res;
    }

    /** Combine a caller signal with a per-request timeout into one signal. */
    private resolveSignal(options?: HTTPRequestOptions): AbortSignal | undefined {
        const timeoutSignal =
            options?.timeout !== undefined ? AbortSignal.timeout(options.timeout) : undefined;

        if (options?.signal && timeoutSignal) {
            return AbortSignal.any([options.signal, timeoutSignal]);
        }

        return options?.signal ?? timeoutSignal;
    }
}
