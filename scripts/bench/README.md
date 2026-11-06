# Layout benchmark

Compares the map layout with the one Tropa 0.1 shipped (dagre, kept in `dagre-as-shipped.ts`): time
and the quality of the drawing. The WebAssembly engine (`assets/wasm/tropa_layout.wasm`) is timed next to
the TypeScript one; it draws the same, so its quality is
not measured twice. Not part of the plugin build.

```bash
npm run bench                 # Node; add -- --full for dagre on 1000 concepts (minutes, ~4 GB)
npm run bench:chromium        # Chromium: both engines, then how long the interface freezes
node scripts/bench/chromium.mjs --shots   # one graph drawn by both engines, dist/bench/shots
```

Chromium runs need `CHROMIUM_PATH` when the installed browser's revision differs from
Playwright's. Run them under a memory limit (`systemd-run --user --scope -p MemoryMax=4G …`).

## Graphs

`gen.ts`: 100, 200, 400 and 1000 concepts, seed 7. Each concept requires 1–3 earlier ones (80%
within the last 24) and recommends a random one with probability 0.5; `+m` adds 0.7 materials per
concept, each teaching one concept (sometimes two) and requiring one with probability 0.3. These
maps are denser than hand-made ones. `sample` is the example map that ships with the plugin.

## Quality

Measured on the drawn curves (`metrics.ts`): pairs of edges that cross (edges sharing a node not
counted), edges drawn through a node they do not belong to, width and height of the drawing.
`npm run bench` fails when, on `200` and `400+m`, the layout has more crossings or more edges
through nodes than dagre, or a width or height more than 15% off. CI runs it as an informational job.
