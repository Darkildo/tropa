// Builds the layout engine's Rust port (crates/tropa-layout) to dist/wasm/tropa_layout.wasm and
// prints its size and sha256. `--verify` builds it a second time from scratch, in another target
// folder, and fails unless both are the same byte for byte.
// Needs the Rust toolchain of crates/tropa-layout/rust-toolchain.toml; wasm-opt comes from npm (binaryen).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(".");
const crate = join(root, "crates/tropa-layout");
const out = join(root, "dist/wasm/tropa_layout.wasm");
// What rustc enables for wasm32-unknown-unknown by default. The release build strips the section
// that would tell wasm-opt, so they are named here.
const FEATURES = ["bulk-memory", "bulk-memory-opt", "nontrapping-float-to-int", "sign-ext", "mutable-globals", "multivalue", "reference-types"].map((f) => `--enable-${f}`);

function build(targetDir, output) {
  const env = {
    ...process.env,
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "4",
    CARGO_TARGET_DIR: targetDir,
    // Paths of this machine must not end up in the module.
    RUSTFLAGS: `--remap-path-prefix=${root}=/tropa --remap-path-prefix=${process.env.CARGO_HOME ?? join(process.env.HOME ?? "", ".cargo")}=/cargo`,
  };
  execFileSync("cargo", ["build", "--release", "--locked", "--target", "wasm32-unknown-unknown"], { cwd: crate, env, stdio: "inherit" });
  mkdirSync(join(output, ".."), { recursive: true });
  execFileSync(join(root, "node_modules/.bin/wasm-opt"), ["-O3", ...FEATURES, join(targetDir, "wasm32-unknown-unknown/release/tropa_layout.wasm"), "-o", output], { stdio: "inherit" });
  return createHash("sha256").update(readFileSync(output)).digest("hex");
}

const hash = build(join(crate, "target"), out);
console.log(`dist/wasm/tropa_layout.wasm  ${readFileSync(out).length} bytes  sha256 ${hash}`);

if (process.argv.includes("--verify")) {
  const scratch = mkdtempSync(join(tmpdir(), "tropa-wasm-"));
  try {
    const again = build(join(scratch, "target"), join(scratch, "tropa_layout.wasm"));
    if (again !== hash) throw new Error(`Not reproducible: a second build from scratch gave sha256 ${again}`);
    console.log("Reproducible: a second build from scratch gives the same sha256.");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
