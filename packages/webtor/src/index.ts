/**
 * @kohaku-eth/webtor
 *
 * Tor integration for browser via WebAssembly.
 * Provides anonymous HTTP/HTTPS through Tor using Snowflake (WebRTC) and WebTunnel bridges.
 */

export {
  TorClient,
  TorClientOptions,
  type JsHttpResponse,
  type JsCircuitStatus,
  init,
  setDebugEnabled,
  setLogCallback,
} from "webtor-wasm"

export type { InitInput, InitOutput, SyncInitInput } from "webtor-wasm"
