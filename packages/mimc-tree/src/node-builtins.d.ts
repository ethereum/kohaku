declare module 'node:os' {
  export function availableParallelism(): number;
}

declare module 'node:worker_threads' {
  export class Worker {
    constructor(filename: URL | string, options?: { name?: string; type?: 'module'; workerData?: unknown });
    postMessage(value: unknown, transferList?: readonly unknown[]): void;
    unref(): void;
    terminate(): Promise<number>;
    on(event: string, listener: (...args: unknown[]) => void): void;
    off(event: string, listener: (...args: unknown[]) => void): void;
  }

  export class MessageChannel {
    port1: MessagePort;
    port2: MessagePort;
  }

  export interface MessagePort {
    postMessage(value: unknown): void;
    close(): void;
  }

  export function receiveMessageOnPort(port: MessagePort): { message: unknown } | undefined;

  export const workerData: unknown;

  export const parentPort:
    | (MessagePort & {
        on(event: 'message', listener: (value: unknown) => void): void;
      })
    | null;
}
