// Builds the layout engine's Rust port (crates/tropa-layout) to assets/wasm/tropa_layout.wasm, the
// copy kept in git that main.js inlines, and prints its size and sha256. `--verify` writes nothing:
// it builds the module twice from scratch, in separate target folders, and fails unless both builds
// and the copy in git are the same byte for byte.
// Needs the Rust toolchain of crates/tropa-layout/rust-toolchain.toml; wasm-opt comes from npm (binaryen).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(".");
const crate = join(root, "crates/tropa-layout");
const kept = join(root, "assets/wasm/tropa_layout.wasm");
// What rustc enables for wasm32-unknown-unknown by default. The release build strips the section
// that would tell wasm-opt, so they are named here.
const FEATURES = ["bulk-memory", "bulk-memory-opt", "nontrapping-float-to-int", "sign-ext", "mutable-globals", "multivalue", "reference-types"].map((f) => `--enable-${f}`);

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

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
  return sha256(output);
}

if (process.argv.includes("--verify")) {
  const scratch = mkdtempSync(join(tmpdir(), "tropa-wasm-"));
  try {
    const first = build(join(crate, "target"), join(scratch, "first.wasm"));
    const second = build(join(scratch, "target"), join(scratch, "second.wasm"));
    if (second !== first) throw new Error(`Not reproducible: two builds from scratch gave sha256 ${first} and ${second}`);
    console.log(`Reproducible: two builds from scratch give sha256 ${first}.`);
    const inGit = sha256(kept);
    if (inGit !== first) throw new Error(`assets/wasm/tropa_layout.wasm (sha256 ${inGit}) is not what crates/tropa-layout builds: run npm run build:wasm and commit the result`);
    console.log("assets/wasm/tropa_layout.wasm matches the build from source.");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
} else {
  const hash = build(join(crate, "target"), kept);
  console.log(`assets/wasm/tropa_layout.wasm  ${readFileSync(kept).length} bytes  sha256 ${hash}`);
}
