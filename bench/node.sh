#!/usr/bin/env bash
# Node timings, one process per graph. A case that dies (out of memory) is rerun without the engine
# that was running and gets an "error" row for it, so the table still shows what happened.
set -u
LIMIT="systemd-run --user --scope -q -p MemoryMax=5G -p MemorySwapMax=0"
HEAP=${HEAP:-4096}
for name in sample sample+m 100 100+m 200 200+m 400 400+m 1000 1000+m; do
  for attempt in 1 2 3 4 5 6 7; do
    $LIMIT node --max-old-space-size=$HEAP dist/bench/node.mjs --case="$name" >> dist/bench/node.log 2>&1 && break
    last=$(grep -F "node $name " dist/bench/node.log | grep -E "^node [^ ]+ [a-z-]+:" | tail -1 | awk '{print $3}' | tr -d :)
    order=(dagre dagre-lp dagre-ns elk sugi-ts sugi-wasm crate-wasm)
    next=""
    for i in "${!order[@]}"; do [ "${order[$i]}" = "$last" ] && next=${order[$((i + 1))]:-}; done
    [ -z "$last" ] && next=dagre
    [ -z "$next" ] && break
    echo "{\"engine\":\"$next\",\"case\":\"$name\",\"error\":\"process died (V8 heap ${HEAP} MB, 5 GB memory limit)\"}" >> dist/bench/node.jsonl
    echo "node $name $next: ERROR process died" >> dist/bench/node.log
  done
done
echo "node bench finished" >> dist/bench/node.log
