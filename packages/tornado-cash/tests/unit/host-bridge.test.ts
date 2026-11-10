/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-restricted-syntax -- comlink's wire format names the message id `id` */
import { MnemonicKeystore, scopeKeystore } from '@kohaku-eth/plugins';
import { expose, proxy, releaseProxy, transferHandlers, wrap, type Remote } from 'comlink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundlerPostVia, createPaymasterBundlerClient, getUserOperationGasPrice, networkFromBundlerPost, type BundlerPost } from '../../src/paymaster/utils';
import { anyArgs, exposeCall, exposeOnly, registerHostBridge } from '../../src/plugin/host-bridge';
import {
  bundlerPostCheck,
  keystorePolicy,
  providerPolicy,
  secretManagerPolicy,
  storagePolicy,
  tailCallsCheck,
} from '../../src/plugin/worker-host-policy';

const MNEMONIC = 'test test test test test test test test test test test junk';
const OWN_PATH = "m/29795'/1'/0'";
const WALLET_PATH = "m/44'/60'/0'/0/0";
const FAKE_KEY = `0x${'11'.repeat(32)}`;

// Keeps its seed in a TypeScript-private field, as MnemonicKeystore did. `private`
// is not enforced at runtime, so a comlink GET can read it.
class SeedKeystore {
  private mnemonic = MNEMONIC;

  async deriveAt(path: string) {
    return new MnemonicKeystore(this.mnemonic).deriveAt(path);
  }
}

declare global {
  var __h8: unknown;
}

const ports: MessagePort[] = [];

afterEach(() => {
  ports.splice(0).forEach((port) => port.close());
  delete globalThis.__h8;
});

// Host side of the old wiring: comlink `proxy()` does `expose(obj, port)`.
function viaComlinkProxy<T>(target: T): Remote<T> {
  const { port1, port2 } = new MessageChannel();

  ports.push(port1, port2);
  expose(target, port1);

  return wrap<T>(port2);
}

// The worker's end of a host-bridge channel, as the transfer handler creates it.
function bridgePort(marked: unknown): MessagePort {
  registerHostBridge();

  const [port] = transferHandlers.get('kohaku:host-bridge')!.serialize(marked) as [MessagePort, Transferable[]];

  ports.push(port);

  return port;
}

let rawId = 0;

// A compromised worker is not limited to what comlink's proxy would send.
function send(port: MessagePort, message: object, transfer: Transferable[] = []): Promise<any> {
  const id = `raw-${++rawId}`;

  return new Promise((resolve) => {
    const onMessage = ({ data }: MessageEvent) => {
      if (data?.id !== id) return;

      port.removeEventListener('message', onMessage);
      resolve(data);
    };

    port.addEventListener('message', onMessage);
    port.start();
    port.postMessage({ id, ...message }, transfer);
  });
}

const refusal = (reply: any): string | undefined =>
  reply?.type === 'HANDLER' && reply.name === 'throw' ? reply.value.value.message : undefined;

const read = async (value: unknown) => await value;

describe('comlink proxy() of a host keystore (old wiring)', () => {
  it('lets the worker read the mnemonic', async () => {
    const remote = viaComlinkProxy(new SeedKeystore()) as any;

    expect(await remote.mnemonic).toBe(MNEMONIC);
  });

  it('lets the worker run code on the host via constructor.constructor', async () => {
    const remote = viaComlinkProxy(new SeedKeystore()) as any;
    const fn = await new remote.constructor.constructor('globalThis.__h8 = "pwned"; return typeof process');

    expect(await fn()).toBe('object');
    expect(globalThis.__h8).toBe('pwned');
  });

  it('lets the worker overwrite deriveAt for everyone holding the keystore', async () => {
    const keystore = new SeedKeystore();
    const remote = viaComlinkProxy(keystore) as any;

    remote.deriveAt = proxy(async () => FAKE_KEY);
    await read(remote.mnemonic); // round trip: the SET has been applied

    expect(await keystore.deriveAt(OWN_PATH)).toBe(FAKE_KEY);
  });
});

describe('host bridge', () => {
  it('refuses to read the mnemonic', async () => {
    const port = bridgePort(exposeOnly(new SeedKeystore(), keystorePolicy));
    const remote = wrap<any>(port);

    await expect(read(remote.mnemonic)).rejects.toThrow('GET is not allowed on host objects');
    expect(refusal(await send(port, { type: 'GET', path: [] }))).toBe('GET is not allowed on host objects');
  });

  it('refuses constructor.constructor, so no code runs on the host', async () => {
    const port = bridgePort(exposeOnly(new SeedKeystore(), keystorePolicy));
    const remote = wrap<any>(port);

    await expect(read(new remote.constructor.constructor('globalThis.__h8 = "pwned"'))).rejects.toThrow('CONSTRUCT is not allowed');
    await expect(remote.constructor.constructor('globalThis.__h8 = "pwned"')).rejects.toThrow('constructor.constructor is not exposed');
    await expect(remote.deriveAt.constructor('globalThis.__h8 = "pwned"')).rejects.toThrow('deriveAt.constructor is not exposed');
    await expect(remote.deriveAt.call(null, OWN_PATH)).rejects.toThrow('deriveAt.call is not exposed');
    expect(globalThis.__h8).toBeUndefined();
  });

  it('refuses to overwrite deriveAt', async () => {
    const keystore = new SeedKeystore();
    const original = keystore.deriveAt;
    const port = bridgePort(exposeOnly(keystore, keystorePolicy));
    const reply = await send(port, { type: 'SET', path: ['deriveAt'], value: { type: 'RAW', value: FAKE_KEY } });

    expect(refusal(reply)).toBe('SET is not allowed on host objects');
    expect(keystore.deriveAt).toBe(original);
    expect(await keystore.deriveAt(OWN_PATH)).not.toBe(FAKE_KEY);
  });

  it('refuses ENDPOINT, which would re-expose the object unfiltered', async () => {
    const port = bridgePort(exposeOnly(new SeedKeystore(), keystorePolicy));

    expect(refusal(await send(port, { type: 'ENDPOINT' }))).toBe('ENDPOINT is not allowed on host objects');
  });

  it('refuses arguments that are not plain data', async () => {
    const deriveAt = vi.fn();
    const port = bridgePort(exposeOnly({ deriveAt }, keystorePolicy));
    const { port2 } = new MessageChannel();

    ports.push(port2);

    for (const [arg, transfer] of [
      [{ type: 'HANDLER', name: 'proxy', value: port2 }, [port2]],
      [{ type: 'HANDLER', name: 'throw', value: { isError: true, value: { message: 'x' } } }, []],
    ] as const) {
      const reply = await send(port, { type: 'APPLY', path: ['deriveAt'], argumentList: [arg] }, [...transfer]);

      expect(refusal(reply)).toBe('Arguments must be plain data');
    }

    expect(deriveAt).not.toHaveBeenCalled();
  });

  it('still answers allowlisted calls, behind the scoped keystore', async () => {
    const inner = new MnemonicKeystore(MNEMONIC);
    const scoped = scopeKeystore(inner, { prefixes: ["m/29795'/1'"] });
    const remote = wrap<any>(bridgePort(exposeOnly(scoped, keystorePolicy)));

    expect(await remote.deriveAt(OWN_PATH)).toBe(await inner.deriveAt(OWN_PATH));
    await expect(remote.deriveAt(WALLET_PATH)).rejects.toThrow('Keystore path not allowed');
    await expect(remote.deriveAt('m')).rejects.toThrow('Invalid derivation path');
    await expect(remote.deriveAt(42)).rejects.toThrow('deriveAt takes one path string');
    await expect(remote.deriveAt(OWN_PATH, 'extra')).rejects.toThrow('deriveAt takes one path string');
  });

  it('sends host results back as data, never as a live reference', async () => {
    const secretHolder = { mnemonic: MNEMONIC };
    const remote = wrap<any>(bridgePort(exposeOnly({ leak: () => proxy(secretHolder) }, { leak: anyArgs })));

    await expect(remote.leak()).rejects.toThrow('Host calls return plain data only');
  });

  it('exposes a host function as callable only', async () => {
    const loader = vi.fn(async () => ({ circuitText: 'c' }));
    const port = bridgePort(exposeCall(loader));
    const remote = wrap<any>(port);

    expect(await remote()).toEqual({ circuitText: 'c' });
    await expect(read(remote.name)).rejects.toThrow('GET is not allowed');
    await expect(remote.call(null)).rejects.toThrow('call is not exposed');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reaches the worker as an ordinary comlink remote through the transfer handler', async () => {
    registerHostBridge();

    const { port1, port2 } = new MessageChannel();
    let held: Remote<SeedKeystore> | undefined;

    ports.push(port1, port2);
    // Stand-in for the worker's `init`: keeps the remote it was handed.
    expose({ init: (keystore: Remote<SeedKeystore>) => { held = keystore; } }, port1);
    await wrap<any>(port2).init(exposeOnly(new SeedKeystore(), keystorePolicy));

    expect(await held!.deriveAt(OWN_PATH)).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(read((held as any).mnemonic)).rejects.toThrow('GET is not allowed');
    held![releaseProxy]();
  });
});

describe('worker host policy', () => {
  it('round-trips bundler requests through the restricted host network bridge', async () => {
    const url = 'https://bundler.example.test/rpc';
    const tier = { maxFeePerGas: '0x2', maxPriorityFeePerGas: '0x1' };
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));

      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { slow: tier, standard: tier, fast: tier } }));
    });
    const post = wrap<BundlerPost>(bridgePort(exposeCall(bundlerPostVia({ fetch }), bundlerPostCheck([url]))));
    const client = createPaymasterBundlerClient(url, networkFromBundlerPost(post));

    expect((await getUserOperationGasPrice(client)).standard).toEqual({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(url);
    await expect(post('https://other.example.test/rpc', '{}')).rejects.toThrow('configured bundler');
    expect(fetch).toHaveBeenCalledTimes(1);
    post[releaseProxy]();
  });

  it('keeps storage access inside the tornado-cash- namespace', async () => {
    const data = new Map([['privacy-pool-state-1', 'theirs']]);
    const storage = { _brand: 'Storage' as const, get: async (key: string) => data.get(key) ?? null, set: async (key: string, value: string) => void data.set(key, value) };
    const remote = wrap<any>(bridgePort(exposeOnly(storage, storagePolicy)));

    await remote.set('tornado-cash-state-1-2', '{}');
    expect(await remote.get('tornado-cash-state-1-2')).toBe('{}');
    await expect(remote.get('privacy-pool-state-1')).rejects.toThrow('outside the tornado-cash- namespace');
    await expect(remote.set('privacy-pool-state-1', 'x')).rejects.toThrow('outside the tornado-cash- namespace');
    expect(data.get('privacy-pool-state-1')).toBe('theirs');
  });

  it('lets provider.request through for reads only', async () => {
    const request = vi.fn(async () => '0x');
    const remote = wrap<any>(bridgePort(exposeOnly({ request } as any, providerPolicy)));

    expect(await remote.request({ method: 'eth_call', params: [] })).toBe('0x');
    await expect(remote.request({ method: 'eth_sendTransaction', params: [] })).rejects.toThrow('not allowed from the worker');
    await expect(remote.request({ method: 'personal_sign', params: [] })).rejects.toThrow('not allowed from the worker');
    await expect(remote.getBalance('0x0000000000000000000000000000000000000000')).rejects.toThrow('getBalance is not exposed');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('only derives delegator keys for paths the integrator named', async () => {
    const granted = new Set<string>();
    const deriveDelegatorSigner = vi.fn(async () => FAKE_KEY);
    const remote = wrap<any>(bridgePort(exposeOnly({ deriveDelegatorSigner } as any, secretManagerPolicy(granted))));

    await expect(remote.deriveDelegatorSigner({ path: WALLET_PATH })).rejects.toThrow('Keystore path not allowed');
    granted.add("m/44'/60'/0'/0/3");
    expect(await remote.deriveDelegatorSigner({ path: "m/44'/60'/0'/0/3" })).toBe(FAKE_KEY);
    expect(deriveDelegatorSigner).toHaveBeenCalledTimes(1);
  });

  it('calls tailCalls with an address only', () => {
    expect(() => tailCallsCheck(['0x00000000000000000000000000000000000000aa'])).not.toThrow();
    expect(() => tailCallsCheck([{ to: '0x' }])).toThrow('tailCalls takes one address');
  });

  it('posts bundler JSON-RPC only to a configured bundler', () => {
    const allowed = bundlerPostCheck(['http://127.0.0.1:3001', 'https://public.pimlico.io/v2/1/rpc']);

    expect(() => allowed(['http://127.0.0.1:3001/', '{}'])).not.toThrow();
    expect(() => allowed(['https://public.pimlico.io/v2/1/rpc', '{}'])).not.toThrow();
    expect(() => allowed(['https://example.test/rpc', '{}'])).toThrow('configured bundler');
    expect(() => allowed(['not a url', '{}'])).toThrow('configured bundler');
    expect(() => allowed(['http://127.0.0.1:3001/', { body: '{}' }])).toThrow('configured bundler');
  });
});
