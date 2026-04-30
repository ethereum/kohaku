// Empty stub for Node.js builtins that websnark probes for inside try/catch
// to detect browser vs Node.js at runtime. Bundling them as stubs keeps the
// require() calls inside the try/catch rather than hoisting them as ESM imports.
export default {};
export const Worker = undefined;
