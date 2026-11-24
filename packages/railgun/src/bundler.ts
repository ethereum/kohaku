import type { Hex, PreparedUserOperation } from "./types";

export interface BundlerTransport {
  url: string;
  /** Supply the CLI's Tor-aware fetch when privacy routing is enabled. */
  fetch: typeof globalThis.fetch;
}

export interface UserOperationReceipt {
  userOpHash: Hex;
  success: boolean;
  receipt?: { transactionHash?: Hex; [key: string]: unknown };
  [key: string]: unknown;
}

export class BundlerSubmissionError extends Error {
  constructor(
    message: string,
    readonly userOpHash: Hex,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BundlerSubmissionError";
  }
}

async function rpc<T>(
  transport: BundlerTransport,
  method: string,
  params: unknown[],
  signal?: AbortSignal,
): Promise<T> {
  const response = await transport.fetch(transport.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  if (!response.ok) throw new Error(`Bundler HTTP ${response.status} for ${method}`);
  const body = await response.json() as {
    jsonrpc?: string;
    id?: number;
    result?: T;
    error?: { code?: number; message?: string };
  };
  if (body.jsonrpc !== "2.0" || body.id !== 1) {
    throw new Error(`Invalid bundler JSON-RPC response for ${method}`);
  }
  if (body.error) {
    throw new Error(`Bundler ${method}: ${body.error.message ?? "unknown error"}`);
  }
  if (!("result" in body)) {
    throw new Error(`Bundler ${method} omitted result`);
  }
  return body.result as T;
}

/** The prepared operation has already been checkpointed by RailgunWallet. */
export async function sendUserOperation(
  prepared: PreparedUserOperation,
  transport: BundlerTransport,
  signal?: AbortSignal,
): Promise<Hex> {
  try {
    const hash = await rpc<string>(
      transport,
      "eth_sendUserOperation",
      [prepared.signed.userOp, prepared.signed.entryPoint],
      signal,
    );
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error("Bundler returned an invalid UserOperation hash");
    }
    if (hash.toLowerCase() !== prepared.userOpHash.toLowerCase()) {
      throw new Error(`Bundler returned hash ${hash}, expected ${prepared.userOpHash}`);
    }
    return hash as Hex;
  } catch (cause) {
    // A timeout may occur after the bundler accepted the operation. The caller
    // must poll this known hash before deciding whether to submit again.
    throw new BundlerSubmissionError(
      `Could not confirm UserOperation submission; check ${prepared.userOpHash} before retrying`,
      prepared.userOpHash,
      { cause },
    );
  }
}

/** Returns null while pending. A failed included UserOperation has success=false. */
export async function getUserOperationReceipt(
  userOpHash: Hex,
  transport: BundlerTransport,
  signal?: AbortSignal,
): Promise<UserOperationReceipt | null> {
  const receipt = await rpc<UserOperationReceipt | null>(
    transport,
    "eth_getUserOperationReceipt",
    [userOpHash],
    signal,
  );
  if (receipt !== null) {
    if (typeof receipt !== "object" ||
      typeof receipt.userOpHash !== "string" ||
      receipt.userOpHash.toLowerCase() !== userOpHash.toLowerCase()) {
      throw new Error(`Bundler receipt does not match UserOperation ${userOpHash}`);
    }
    if (typeof receipt.success !== "boolean") {
      throw new Error(`Bundler receipt has invalid success status for UserOperation ${userOpHash}`);
    }
  }
  return receipt;
}

export async function waitForUserOperationReceipt(
  userOpHash: Hex,
  transport: BundlerTransport,
  options: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal } = {},
): Promise<UserOperationReceipt> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const pollMs = options.pollMs ?? 2_000;
  if (timeoutMs < 0 || pollMs <= 0) throw new RangeError("Invalid receipt polling interval");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    options.signal?.throwIfAborted();
    const receipt = await getUserOperationReceipt(userOpHash, transport, options.signal);
    if (receipt) return receipt;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out waiting for UserOperation ${userOpHash}`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        options.signal?.removeEventListener("abort", abort);
        resolve();
      }, Math.min(pollMs, remaining));
      const abort = () => {
        clearTimeout(timer);
        reject(options.signal?.reason ?? new Error("Receipt wait aborted"));
      };
      options.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}
