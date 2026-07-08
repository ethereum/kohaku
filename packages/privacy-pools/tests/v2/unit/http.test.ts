import type { Network } from "@kohaku-eth/plugins";
import { describe, expect, it, vi } from "vitest";
import { KohakuHttpClient } from "../../../src/v2/adapters/http.adapter";

function networkWith(response: Partial<Response>): { network: Network; fetch: ReturnType<typeof vi.fn> } {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", ...response }) as Response);

    return { network: { fetch } as unknown as Network, fetch };
}

describe("KohakuHttpClient", () => {
    it("get() parses JSON via host fetch", async () => {
        const { network, fetch } = networkWith({ json: async () => ({ hello: "world" }) });
        const client = new KohakuHttpClient(network);

        expect(await client.get<{ hello: string }>("https://api.example/x")).toEqual({
            hello: "world",
        });
        expect(fetch).toHaveBeenCalledWith(
            "https://api.example/x",
            expect.objectContaining({ method: "GET" }),
        );
    });

    it("post() JSON-serializes the body with content-type", async () => {
        const { network, fetch } = networkWith({ json: async () => ({ ok: 1 }) });
        const client = new KohakuHttpClient(network);

        await client.post("https://api.example/y", { a: 1 });
        const init = fetch.mock.calls[0]?.[1] as RequestInit;

        expect(init.method).toBe("POST");
        expect(init.body).toBe(JSON.stringify({ a: 1 }));
        expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    });

    it("getBinary() returns raw bytes", async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const { network } = networkWith({ arrayBuffer: async () => bytes.buffer });
        const client = new KohakuHttpClient(network);

        expect(await client.getBinary("https://gw.example/cid")).toEqual(bytes);
    });

    it("throws on non-OK responses", async () => {
        const { network } = networkWith({ ok: false, status: 503, statusText: "Unavailable" });
        const client = new KohakuHttpClient(network);

        await expect(client.get("https://api.example/down")).rejects.toThrowError(/503/);
    });
});
