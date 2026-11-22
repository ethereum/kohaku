declare module "#worker-loader" {
  export function createRailgunWorker(): import("./worker-handle.js").RailgunWorkerHandle;
}
