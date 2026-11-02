import { appendFileSync } from "node:fs";
import { initWasm } from "./engines";

// Cold start of both modules, as the plugin would pay on load: run it in a fresh process each time.
const result = initWasm();
appendFileSync("dist/bench/wasm-init-node.jsonl", JSON.stringify(result) + "\n");
console.log(JSON.stringify(result));
