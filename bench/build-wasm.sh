#!/usr/bin/env bash
# Builds crates/tropa-layout to WebAssembly: `own` is the port of bench/sugi.ts alone,
# `crate` adds the rust-sugiyama comparison. Run under the memory limit, see bench/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."
crate=crates/tropa-layout
out=dist/wasm

for variant in own crate; do
  features=""
  [ "$variant" = crate ] && features="--features crate-sugiyama"
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}" cargo build --manifest-path "$crate/Cargo.toml" --release --target wasm32-unknown-unknown $features
  rm -rf "$out/$variant"
  wasm-bindgen --target web --out-dir "$out/$variant" "$crate/target/wasm32-unknown-unknown/release/tropa_layout.wasm"
  # Imported as base64 text, not as a module.
  rm -f "$out/$variant/tropa_layout_bg.wasm.d.ts"
  node_modules/.bin/wasm-opt -O3 "$out/$variant/tropa_layout_bg.wasm" -o "$out/$variant/tropa_layout_bg.wasm"
  ls -l "$out/$variant/tropa_layout_bg.wasm"
done
