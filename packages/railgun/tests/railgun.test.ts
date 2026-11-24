import { describe, expect, test } from "vitest";
import {
  BundlerSubmissionError, RailgunWorkerWallet, createRailgunBroadcaster,
  createRailgunPlugin, getUserOperationReceipt, railgunKeyPaths,
  sendUserOperation,
} from "../dist/index.js";
import { createCheckpointCipher } from "../src/checkpoint-crypto.js";

const chainId = 11155111n;
const rpcUrl = "https://rpc.example.invalid";
const spendingKey = `0x${"01".repeat(32)}` as const;
const viewingKey = `0x${"02".repeat(32)}` as const;
const expectedAddress = "0zk1qys4xfe9ucy0266kyfzdv8h322y282elqxmhjpvxl8ksctnm4f4jjunpd9kx0h6c57qnjacw4p73wh6k5d2xds6v0mxvhrv2jx6wudazthmq7ku0exeeg4uye6h";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function mockRpc() {
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    expect(request.url).toBe(`${rpcUrl}/`);
    expect(request.method).toBe("POST");
    const body = await request.json() as { method: string; id: number };
    requests.push(body.method);
    expect(body.method).toBe("eth_chainId");
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0xaa36a7" }), {
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, requests };
}

function mockHost(options: { persist?: (key: string, value: string) => Promise<void> } = {}) {
  const storage = new Map<string, string>();
  const rpc = mockRpc();
  let providerChainId = chainId;
  const paths = railgunKeyPaths();
  const host = {
    provider: { getChainId: async () => providerChainId },
    network: { fetch: rpc.fetch },
    storage: {
      _brand: "Storage" as const,
      get: async (key: string) => storage.get(key) ?? null,
      set: async (key: string, value: string) => {
        await options.persist?.(key, value);
        storage.set(key, value);
      },
    },
    keystore: { deriveAt: async (path: string) => {
      if (path === paths.spending) return spendingKey;
      if (path === paths.viewing) return viewingKey;
      if (path === "m/44'/60'/0'/0/0") return `0x${"03".repeat(32)}`;
      throw new Error(`Unexpected keystore path ${path}`);
    } },
  };
  return { host, storage, requests: rpc.requests, setChainId: (id: bigint) => { providerChainId = id; } };
}

const pluginOptions = {
  rpcUrl,
  bundlerUrl: "https://bundler.example.invalid",
  accountSigningPath: "m/44'/60'/0'/0/0",
};

describe("current Rust Railgun WASM through the SDK worker", () => {
  test("derives the known address, routes RPC through the host, and scopes checkpoints", async () => {
    const { host, storage, requests } = mockHost();
    const plugin = await createRailgunPlugin(host as never, pluginOptions);
    try {
      expect(await plugin.instanceId()).toBe(expectedAddress);
      expect(requests).toEqual(["eth_chainId"]);
      expect(plugin.chain.chainId).toBe(chainId);
      expect(await plugin.balance(undefined, { sync: false })).toEqual([]);
      expect(await plugin.notes(undefined, false, { sync: false })).toEqual([]);
      expect((await plugin.processPendingPoi()).pendingAfter).toBe(0);
      const key = `railgun-v1:${chainId}:${expectedAddress.toLowerCase()}:0`;
      expect(storage.has(key)).toBe(true);
      const envelope = JSON.parse(storage.get(key)!);
      expect(envelope.version).toBe(1);
      expect(envelope.nonce).toMatch(/^0x[0-9a-f]{24}$/);
      expect(envelope.ciphertext).toMatch(/^0x[0-9a-f]+$/);
      expect(storage.get(key)).not.toContain('"railgun"');
    } finally { plugin.close(); }

    const restored = await createRailgunPlugin(host as never, pluginOptions);
    try { expect(await restored.instanceId()).toBe(expectedAddress); }
    finally { restored.close(); }
  });

  test("persists the checkpoint before returning and propagates storage failure", async () => {
    const entered = gate();
    const release = gate();
    let fail = false;
    const { host } = mockHost({ persist: async () => {
      entered.release();
      await release.promise;
      if (fail) throw new Error("fixture storage failure");
    } });
    const plugin = await createRailgunPlugin(host as never, pluginOptions);
    try {
      let settled = false;
      const pending = plugin.processPendingPoi().then(() => { settled = true; });
      await entered.promise;
      expect(settled).toBe(false);
      release.release();
      await pending;
      fail = true;
      await expect(plugin.processPendingPoi()).rejects.toThrow("fixture storage failure");
    } finally { release.release(); plugin.close(); }
  });

  test("builds native and ERC-20 shields, rejects mismatched host chain", async () => {
    const { host, setChainId } = mockHost();
    const plugin = await createRailgunPlugin(host as never, pluginOptions);
    try {
      const native = await plugin.prepareShield({ asset: { __type: "native" }, amount: 1000n });
      expect(native.txns).toHaveLength(1);
      expect(native.txns[0]!.value).toBe(1000n);
      const token = "0x0000000000000000000000000000000000000001";
      const erc20 = await plugin.prepareShield({ asset: { __type: "erc20", contract: token }, amount: 42n });
      expect(erc20.txns).toHaveLength(2);
      expect(erc20.txns[0]!.to).toBe(token);
      expect(erc20.txns[0]!.data).toContain(plugin.chain.railgunSmartWallet.slice(2).toLowerCase());
      expect(erc20.txns[1]!.value).toBe(0n);
      await expect(plugin.prepareShield({ asset: { __type: "native" }, amount: 0n })).rejects.toThrow(/amount/);
      setChainId(1n);
      await expect(plugin.prepareShield({ asset: { __type: "native" }, amount: 1n })).rejects.toThrow(/does not match/);
    } finally { plugin.close(); }
  });

  test("low-level worker rejects a different RPC chain and preserves error provenance", async () => {
    const rpc = mockRpc();
    await expect(RailgunWorkerWallet.open({
      chainId: 1n,
      rpcUrl,
      spendingKey,
      viewingKey,
      fetch: rpc.fetch,
      persistCheckpoint: async () => {},
    })).rejects.toThrow(/does not match configured chain/);
  });
});

describe("checkpoint encryption", () => {
  test("round-trips with fresh nonces and rejects tampering, wrong key, and plaintext", async () => {
    const scope = "railgun-v1:11155111:0zkfixture:0";
    const cipher = await createCheckpointCipher(viewingKey, scope);
    const one = await cipher.encrypt('{"railgun":{"secret":"fixture"}}');
    const two = await cipher.encrypt('{"railgun":{"secret":"fixture"}}');
    expect(one).not.toBe(two);
    expect(await cipher.decrypt(one)).toBe('{"railgun":{"secret":"fixture"}}');
    await expect(createCheckpointCipher(`0x${"04".repeat(32)}`, scope).then((wrong) => wrong.decrypt(one)))
      .rejects.toThrow(/authentication failed/);
    const envelope = JSON.parse(one);
    const last = Number.parseInt(envelope.ciphertext.slice(-2), 16) ^ 1;
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}${last.toString(16).padStart(2, "0")}`;
    await expect(cipher.decrypt(JSON.stringify(envelope))).rejects.toThrow(/authentication failed/);
    await expect(cipher.decrypt('{"railgun":{}}')).rejects.toThrow(/plaintext checkpoints are not accepted/);
  });
});

describe("bundler submission", () => {
  const hash = `0x${"ab".repeat(32)}` as const;
  const prepared = {
    signed: { userOp: { sender: "0x0000000000000000000000000000000000000001" }, entryPoint: "0x0000000000000000000000000000000000000002" as const },
    userOpHash: hash,
  };

  test("sends the signed Rust wire operation and validates receipt status", async () => {
    const methods: string[] = [];
    const transport = {
      url: pluginOptions.bundlerUrl,
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body));
        methods.push(request.method);
        if (request.method === "eth_sendUserOperation") {
          expect(request.params).toEqual([prepared.signed.userOp, prepared.signed.entryPoint]);
        }
        const result = request.method === "eth_sendUserOperation"
          ? hash : { userOpHash: hash, success: true, receipt: { transactionHash: hash } };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
          headers: { "content-type": "application/json" },
        });
      },
    };
    expect(await sendUserOperation(prepared, transport)).toBe(hash);
    expect((await getUserOperationReceipt(hash, transport))?.success).toBe(true);
    expect(methods).toEqual(["eth_sendUserOperation", "eth_getUserOperationReceipt"]);

    const { host } = mockHost();
    host.network.fetch = transport.fetch as never;
    const broadcaster = createRailgunBroadcaster(host as never);
    const response = await broadcaster.broadcast({
      __type: "privateOperation", mode: "userop", prepared,
      bundlerUrl: pluginOptions.bundlerUrl, chainId,
    });
    expect(response.id).toBe(hash);
    expect((await response.wait()).success).toBe(true);
  });

  test("retains hash after ambiguous send failure and rejects malformed receipt", async () => {
    await expect(sendUserOperation(prepared, {
      url: pluginOptions.bundlerUrl,
      fetch: async () => { throw new Error("timeout"); },
    })).rejects.toMatchObject({ name: BundlerSubmissionError.name, userOpHash: hash });
    await expect(getUserOperationReceipt(hash, {
      url: pluginOptions.bundlerUrl,
      fetch: async () => new Response(JSON.stringify({
        jsonrpc: "2.0", id: 1, result: { userOpHash: hash, success: "false" },
      }), { headers: { "content-type": "application/json" } }),
    })).rejects.toThrow(/invalid success/);
  });
});
