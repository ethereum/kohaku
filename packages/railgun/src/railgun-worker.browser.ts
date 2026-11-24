import { startRailgunWorker } from "./worker-runtime.js";
import type { RailgunWasm } from "./wallet.js";
import type { ParentMessage } from "./worker-protocol.js";

startRailgunWorker({
  postMessage: (message, transfer) => self.postMessage(message, { transfer }),
  onMessage: (handler) => {
    self.addEventListener("message", (event: MessageEvent<ParentMessage>) => handler(event.data));
  },
}, async () => {
  const moduleUrl = new URL("../vendor/wasm/web/kohaku_railgun_wasm.js", import.meta.url).href;
  const wasm = await import(/* @vite-ignore */ moduleUrl) as typeof import("../vendor/wasm/web/kohaku_railgun_wasm.js");
  await wasm.default({ module_or_path: new URL("../vendor/wasm/web/kohaku_railgun_wasm_bg.wasm", import.meta.url) });
  return wasm as RailgunWasm;
});
