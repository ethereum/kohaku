import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { startRailgunWorker } from "./worker-runtime.js";
import type { RailgunWasm } from "./wallet.js";
import type { ParentMessage } from "./worker-protocol.js";

if (!parentPort) throw new Error("Railgun worker requires a parent port");
const port = parentPort;
const require = createRequire(import.meta.url);

startRailgunWorker({
  postMessage: (message, transfer) => port.postMessage(message, transfer as ArrayBuffer[]),
  onMessage: (handler) => port.on("message", (message: ParentMessage) => handler(message)),
}, async () => require(fileURLToPath(new URL("../vendor/wasm/node/kohaku_railgun_wasm.js", import.meta.url))) as RailgunWasm);
