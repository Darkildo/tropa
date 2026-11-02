# Layout benchmark (spike)

Compares the map layout as shipped (dagre) with tuned dagre, elkjs, an own Sugiyama in
TypeScript and its line-by-line Rust port compiled to WebAssembly, plus the `rust-sugiyama`
crate. Not part of the plugin build.

## Candidates

| id | what |
| --- | --- |
| `dagre` | `src/core/layout.ts` as shipped: dagre, tight-tree ranker above 150 nodes |
| `dagre-lp` | dagre with the longest-path ranker |
| `dagre-ns` | dagre with network simplex at every size |
| `elk` | elkjs `layered`, same spacing, polyline routing |
| `sugi-ts` | `bench/sugi.ts`: dagre's pipeline on flat arrays, without dagre's label ranks |
| `sugi-wasm` | `crates/tropa-layout`: the same code in Rust, wasm-bindgen, `wasm-opt -O3`, inlined as base64 |
| `crate-wasm` | `rust-sugiyama` 0.4 behind the same interface (no bend points, no edge weights) |

`sugi-wasm` is checked to draw exactly what `sugi-ts` draws on every case (`port check` lines).

## Graphs

`bench/gen.ts`: 100, 200, 400 and 1000 concepts, seed 7. Each concept requires 1–3 earlier
ones (80% within the last 24), recommends another with probability 0.5; `+m` adds 0.7
materials per concept, each teaching one concept (sometimes two) and requiring one with
probability 0.3. `sample` is the example map that ships with the plugin.

## Running

All heavy steps run under a memory limit:

```bash
LIMIT="systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0"
systemd-run --user --scope -q -p MemoryMax=5G -p MemorySwapMax=0 env CARGO_BUILD_JOBS=4 bench/build-wasm.sh
node bench/build.mjs                                   # bundles + size of each candidate
$LIMIT node dist/bench/node.mjs                        # Node: timings, quality, port check
CHROMIUM_PATH=… $LIMIT node bench/chromium.mjs          # Chromium: timings, dagre in a worker
CHROMIUM_PATH=… $LIMIT node bench/chromium.mjs --shots  # docs/bench/*.png
cargo run --release --manifest-path crates/tropa-layout/Cargo.toml --bin native -- dist/bench/inputs/*.txt
```

Needs `rustup target add wasm32-unknown-unknown` and `wasm-bindgen-cli` 0.2.130.

Timing: two warm-up runs, median and p95 of seven; a case slower than 4 s gets one warm-up and
three runs, and an engine slower than 60 s skips bigger graphs. Quality is measured on the
drawn curves: crossing pairs of edges (edges sharing a node not counted), edges drawn through a
foreign node, size, total edge length, and the share of nodes on the same rank as dagre.

`bench/results` holds the run from 2026-11-02 on devbox (8 vCPU, Node 22.23, Chromium 1234):
raw rows, logs and `tables.md`. The Chromium worker experiment hung on `400+m` and was stopped;
Chromium rows were taken from its log. Another agent's e2e run shared the machine during part of
the Node run, so the slow dagre cases vary by up to ~25% between runs.
