/* eslint-disable no-restricted-syntax -- comlink's wire format names the message id `id` */
import { expose, transferHandlers, wrap, type Endpoint, type TransferHandler } from 'comlink';

/**
 * Host objects crossing into the state worker.
 *
 * comlink's `proxy()` exposes an object to every message type on every path: the
 * worker could read fields (`keystore.mnemonic`), overwrite methods for everyone
 * else holding the object, or reach `constructor.constructor` and run code on the
 * main thread. Here each object gets its own channel, and a filter in front of
 * comlink's `expose` lets through only calls to allowlisted methods, with plain
 * data arguments, after a per-method check. The worker still receives an ordinary
 * comlink remote.
 */

/** Gets a call's arguments as plain data; throws to refuse the call. */
export type ArgsCheck = (args: unknown[]) => void;
export type MethodPolicy<T> = { [K in keyof T & string]?: ArgsCheck };

export const anyArgs: ArgsCheck = () => {};

const HANDLER_NAME = 'kohaku:host-bridge';
const exposure = Symbol('kohaku.hostBridge');

type Policy = { methods: Map<string, ArgsCheck>; call?: ArgsCheck };
type Exposure = { [exposure]: Policy & { target: object } };
type Incoming = { id?: unknown; type?: unknown; path?: unknown; argumentList?: unknown };
type WireArg = { type?: unknown; value?: unknown } | null | undefined;

const thrown = (id: unknown, message: string) => ({
  id,
  type: 'HANDLER',
  name: 'throw',
  value: { isError: true, value: { name: 'Error', message } },
});

// The message comlink may see, rebuilt from checked fields only, or why it was refused.
function admit({ id, type, path, argumentList = [] }: Incoming, { methods, call }: Policy): Incoming | string {
  if (type === 'RELEASE') return { id, type };

  if (type !== 'APPLY') return `${String(type)} is not allowed on host objects`;

  if (!Array.isArray(path) || !Array.isArray(argumentList)) return 'Malformed call';

  const check = path.length === 0
    ? call
    : path.length === 1 && typeof path[0] === 'string' ? methods.get(path[0]) : undefined;

  if (!check) return `${path.map(String).join('.') || '()'} is not exposed to the worker`;

  if (!argumentList.every((arg: WireArg) => arg?.type === 'RAW')) return 'Arguments must be plain data';

  const args = argumentList.map((arg: WireArg) => arg!.value);

  try {
    check(args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return { id, type, path: [...path], argumentList: args.map((value) => ({ type: 'RAW', value })) };
}

function bridgeEndpoint(port: MessagePort, policy: Policy): Endpoint {
  let deliver: ((event: { data: Incoming }) => void) | undefined;

  const onMessage = ({ data }: MessageEvent) => {
    if (!data || typeof data !== 'object') return;

    const admitted = admit(data, policy);

    if (typeof admitted !== 'string') deliver?.({ data: admitted });
    else if (data.id) port.postMessage(thrown(data.id, admitted));
  };

  return {
    postMessage(message, transfer = []) {
      // Results go back as plain data or an error, never as a new live reference.
      if (message?.type === 'HANDLER' && message.name !== 'throw') {
        transfer.forEach((item) => (item as MessagePort).close?.());
        port.postMessage(thrown(message.id, 'Host calls return plain data only'));

        return;
      }

      port.postMessage(message, transfer);
    },
    addEventListener(_type, listener) {
      deliver = (typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)) as unknown as typeof deliver;
      port.addEventListener('message', onMessage);
    },
    // comlink detaches only on RELEASE; the channel is done after that.
    removeEventListener() {
      deliver = undefined;
      port.removeEventListener('message', onMessage);
      port.close();
    },
    start: () => port.start(),
  };
}

const hostBridgeHandler: TransferHandler<unknown, MessagePort> = {
  canHandle: (value) => typeof value === 'object' && value !== null && exposure in value,
  serialize(value) {
    const { target, ...policy } = (value as Exposure)[exposure];
    const { port1, port2 } = new MessageChannel();

    expose(target, bridgeEndpoint(port1, policy));

    return [port2, [port2]];
  },
  deserialize(port) {
    port.start();

    return wrap(port);
  },
};

/** Registers the bridge with comlink. Both the main thread and the worker must call it. */
export function registerHostBridge(): void {
  if (!transferHandlers.has(HANDLER_NAME)) transferHandlers.set(HANDLER_NAME, hostBridgeHandler);
}

/** Sends `target` to the worker with only `methods` callable, each behind its check. */
export function exposeOnly<T extends object>(target: T, methods: MethodPolicy<T>): T {
  registerHostBridge();

  const allowed = Object.entries(methods).filter((entry): entry is [string, ArgsCheck] => typeof entry[1] === 'function');

  return { [exposure]: { target, methods: new Map(allowed) } } as unknown as T;
}

/** Sends a host function to the worker; the worker can only call it. */
export function exposeCall<T extends (...args: never[]) => unknown>(fn: T, check: ArgsCheck = anyArgs): T {
  registerHostBridge();

  return { [exposure]: { target: fn, methods: new Map(), call: check } } as unknown as T;
}
