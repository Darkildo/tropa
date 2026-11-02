/** The layout worker script, see layout-worker.esbuild.mjs. */
declare module "tropa:layout-worker" {
  const source: string;
  export default source;
}

/** The layout engine's WebAssembly as base64, see layout-wasm.esbuild.mjs. Only the worker imports it. */
declare module "tropa:layout-wasm" {
  const base64: string;
  export default base64;
}
