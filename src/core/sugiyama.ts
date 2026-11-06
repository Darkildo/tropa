/**
 * Layered layout on flat arrays, after dagre's pipeline without its label ranks: DFS cycle
 * breaking, network simplex (or tight tree) ranking, dummy chains, barycenter sweeps with dagre's
 * tie rules plus neighbour swaps, Brandes–Köpf coordinates. Soft links never change the ranks, but
 * their dummies take part in ordering, so they cross little, and fill gaps instead of taking room.
 * Typed arrays instead of dagre's graph objects make it 17–55 times faster (`scripts/bench/`).
 */
import type { EngineInput, EngineOutput } from "./layout-engine";

const NODESEP = 40;
const EDGESEP = 18;
const RANKSEP = 64;
/** How far a soft link within one rank reaches into the gap below it. */
const DIP = 38;

interface Csr {
  start: Int32Array;
  items: Int32Array;
}

/** Groups `items` by `key`, keeping their order inside each group. */
function csr(count: number, keys: ArrayLike<number>, items: ArrayLike<number>): Csr {
  const start = new Int32Array(count + 1);
  for (let i = 0; i < keys.length; i++) start[keys[i] + 1]++;
  for (let i = 0; i < count; i++) start[i + 1] += start[i];
  const fill = start.slice(0, count);
  const out = new Int32Array(keys.length);
  for (let i = 0; i < keys.length; i++) out[fill[keys[i]]++] = items[i];
  return { start, items: out };
}

const indices = (n: number) => Int32Array.from({ length: n }, (_, i) => i);

export function sugiyama(input: EngineInput): EngineOutput {
  const n = input.width.length;
  const m = input.from.length;
  if (n === 0) return { x: new Float64Array(0), y: new Float64Array(0), pathStart: new Uint32Array(1), pathPoints: new Float64Array(0) };

  // 1. Break cycles: reverse the edges that point back into the DFS stack.
  const reversed = new Uint8Array(m);
  {
    const out = csr(n, input.from, indices(m));
    const visited = new Uint8Array(n);
    const onStack = new Uint8Array(n);
    const stack: number[] = [];
    const cursor = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (visited[s]) continue;
      visited[s] = onStack[s] = 1;
      cursor[s] = out.start[s];
      stack.push(s);
      while (stack.length) {
        const v = stack[stack.length - 1];
        if (cursor[v] < out.start[v + 1]) {
          const e = out.items[cursor[v]++];
          const w = input.to[e];
          if (onStack[w]) reversed[e] = 1;
          else if (!visited[w]) {
            visited[w] = onStack[w] = 1;
            cursor[w] = out.start[w];
            stack.push(w);
          }
        } else {
          onStack[v] = 0;
          stack.pop();
        }
      }
    }
  }

  // Merge edges that now share both ends. Reversed ones go last, as dagre re-adds them.
  const mergedOf = new Int32Array(m);
  const eFrom: number[] = [];
  const eTo: number[] = [];
  const eWeight: number[] = [];
  {
    const seen = new Map<number, number>();
    for (const pass of [0, 1]) {
      for (let e = 0; e < m; e++) {
        if (reversed[e] !== pass) continue;
        const u = pass ? input.to[e] : input.from[e];
        const v = pass ? input.from[e] : input.to[e];
        const key = u * n + v;
        let k = seen.get(key);
        if (k === undefined) {
          k = eFrom.length;
          seen.set(key, k);
          eFrom.push(u);
          eTo.push(v);
          eWeight.push(0);
        }
        eWeight[k] += input.weight[e];
        mergedOf[e] = k;
      }
    }
  }
  const merged = eFrom.length;

  // 2. Ranks. A root above everything keeps the graph connected, with weight 0 so it costs nothing.
  const rank = rankNodes(n, eFrom, eTo, eWeight, input.tight);

  // 3. Dummy chains for edges longer than one rank.
  const nodeRank: number[] = Array.from(rank);
  const nodeWidth: number[] = Array.from(input.width);
  const nodeHeight: number[] = Array.from(input.height);
  const chains: number[][] = [];
  const lFrom: number[] = [];
  const lTo: number[] = [];
  const lWeight: number[] = [];
  for (let k = 0; k < merged; k++) {
    const chain: number[] = [];
    let prev = eFrom[k];
    for (let r = rank[eFrom[k]] + 1; r < rank[eTo[k]]; r++) {
      const d = nodeRank.length;
      nodeRank.push(r);
      nodeWidth.push(0);
      nodeHeight.push(0);
      chain.push(d);
      lFrom.push(prev);
      lTo.push(d);
      lWeight.push(eWeight[k]);
      prev = d;
    }
    lFrom.push(prev);
    lTo.push(eTo[k]);
    lWeight.push(eWeight[k]);
    chains.push(chain);
  }
  // Soft links do not rank, but they are drawn: their dummies take part in ordering, top end first.
  const firstSoft = nodeRank.length;
  const firstSoftEdge = lFrom.length;
  const softChains: number[][] = [];
  const softTop: number[] = [];
  for (let s = 0; s < input.softFrom.length; s++) {
    let u = input.softFrom[s];
    let v = input.softTo[s];
    if (rank[u] > rank[v]) [u, v] = [v, u];
    const chain: number[] = [];
    softChains.push(chain);
    softTop.push(u);
    if (rank[u] === rank[v]) continue;
    let prev = u;
    for (let r = rank[u] + 1; r < rank[v]; r++) {
      const d = nodeRank.length;
      nodeRank.push(r);
      nodeWidth.push(0);
      nodeHeight.push(0);
      chain.push(d);
      lFrom.push(prev);
      lTo.push(d);
      lWeight.push(1);
      prev = d;
    }
    lFrom.push(prev);
    lTo.push(v);
    lWeight.push(1);
  }
  const total = nodeRank.length;
  const layerEdges = lFrom.length;
  const succ = csr(total, lFrom, indices(layerEdges));
  const pred = csr(total, lTo, indices(layerEdges));
  let maxRank = 0;
  for (let v = 0; v < total; v++) maxRank = Math.max(maxRank, nodeRank[v]);

  // 4. Order inside ranks.
  const order = new Int32Array(total);
  const layering = orderNodes(total, nodeRank, maxRank, lFrom, lTo, lWeight, succ, pred, order);

  // 5. Coordinates. Soft dummies take no room: the rest is placed without them, then they go into
  // the gaps their order gave them.
  const placed = layering.map((layer) => layer.filter((v) => v < firstSoft));
  const placedOrder = new Int32Array(total);
  for (const layer of placed) layer.forEach((v, i) => (placedOrder[v] = i));
  const hard = indices(firstSoftEdge);
  const x = positionX(total, n, placed, placedOrder, nodeWidth, csr(total, lFrom.slice(0, firstSoftEdge), hard), csr(total, lTo.slice(0, firstSoftEdge), hard), lFrom, lTo);
  placeSoft(layering, x, nodeWidth, firstSoft);
  const y = new Float64Array(total);
  const rankHeight = new Float64Array(layering.length);
  let prevY = 0;
  layering.forEach((layer, r) => {
    let maxHeight = 0;
    for (const v of layer) maxHeight = Math.max(maxHeight, nodeHeight[v]);
    for (const v of layer) y[v] = prevY + maxHeight / 2;
    rankHeight[r] = maxHeight;
    prevY += maxHeight + RANKSEP;
  });

  let minX = Infinity;
  let minY = Infinity;
  for (let v = 0; v < n; v++) {
    minX = Math.min(minX, x[v] - nodeWidth[v] / 2);
    minY = Math.min(minY, y[v] - nodeHeight[v] / 2);
  }

  // A rank that holds nothing but soft dummies gives no gap: such a dummy keeps the x above it.
  softChains.forEach((chain, s) => {
    let last = x[softTop[s]];
    for (const d of chain) {
      if (Number.isNaN(x[d])) x[d] = last;
      last = x[d];
    }
  });

  // 6. Edge paths, from the higher end: straight down through every rank, S-bends only in the gaps
  // between ranks, where no node stands. A soft link within one rank dips into the gap below it.
  const points: number[] = [];
  const pathStart = new Uint32Array(m + softChains.length + 1);
  const half = (v: number) => rankHeight[nodeRank[v]] / 2;
  let atX = 0;
  let atY = 0;
  const move = (px: number, py: number) => {
    points.push(px - minX, py - minY);
    atX = px;
    atY = py;
  };
  const curve = (c1x: number, c1y: number, c2x: number, c2y: number, px: number, py: number) => {
    points.push(c1x - minX, c1y - minY, c2x - minX, c2y - minY, px - minX, py - minY);
    atX = px;
    atY = py;
  };
  const down = (py: number) => {
    const third = (py - atY) / 3;
    if (third > 0.1) curve(atX, atY + third, atX, py - third, atX, py);
  };
  const bend = (px: number, py: number) => {
    const middle = (py - atY) / 2;
    curve(atX, atY + middle, px, py - middle, px, py);
  };
  const route = (top: number, bottom: number, chain: number[]) => {
    move(x[top], y[top] + nodeHeight[top] / 2);
    down(y[top] + half(top));
    for (const d of chain) {
      bend(x[d], y[d] - half(d));
      down(y[d] + half(d));
    }
    bend(x[bottom], y[bottom] - half(bottom));
    down(y[bottom] - nodeHeight[bottom] / 2);
  };
  for (let e = 0; e < m; e++) {
    const k = mergedOf[e];
    route(eFrom[k], eTo[k], chains[k]);
    pathStart[e + 1] = points.length / 2;
  }
  softChains.forEach((chain, s) => {
    const top = softTop[s];
    const bottom = top === input.softFrom[s] ? input.softTo[s] : input.softFrom[s];
    if (nodeRank[top] === nodeRank[bottom]) {
      const low = y[top] + half(top) + DIP;
      move(x[top], y[top] + nodeHeight[top] / 2);
      curve(x[top], low, x[bottom], low, x[bottom], y[bottom] + nodeHeight[bottom] / 2);
    } else route(top, bottom, chain);
    pathStart[m + s + 1] = points.length / 2;
  });

  const outX = new Float64Array(n);
  const outY = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    outX[v] = x[v] - minX;
    outY[v] = y[v] - minY;
  }
  return { x: outX, y: outY, pathStart, pathPoints: Float64Array.from(points) };
}

/** Puts each run of soft dummies evenly into the gap between the nodes or dummies around it. */
function placeSoft(layering: number[][], x: Float64Array, width: number[], firstSoft: number) {
  for (const layer of layering) {
    for (let i = 0; i < layer.length; ) {
      if (layer[i] < firstSoft) {
        i++;
        continue;
      }
      let j = i;
      while (j < layer.length && layer[j] >= firstSoft) j++;
      const left = i > 0 ? layer[i - 1] : -1;
      const right = j < layer.length ? layer[j] : -1;
      const count = j - i;
      const leftEdge = left >= 0 ? x[left] + width[left] / 2 : 0;
      const rightEdge = right >= 0 ? x[right] - width[right] / 2 : 0;
      for (let k = 0; k < count; k++) {
        const v = layer[i + k];
        if (left >= 0 && right >= 0) x[v] = leftEdge + ((k + 1) * (rightEdge - leftEdge)) / (count + 1);
        else if (left >= 0) x[v] = leftEdge + NODESEP / 2 + k * EDGESEP;
        else if (right >= 0) x[v] = rightEdge - NODESEP / 2 - (count - 1 - k) * EDGESEP;
        else x[v] = NaN;
      }
      i = j;
    }
  }
}

function rankNodes(n: number, from: number[], to: number[], weight: number[], tight: boolean): Int32Array {
  const root = n;
  const size = n + 1;
  const eFrom = [...from];
  const eTo = [...to];
  const eWeight = [...weight];
  for (let v = 0; v < n; v++) {
    eFrom.push(root);
    eTo.push(v);
    eWeight.push(0);
  }
  const edges = eFrom.length;
  const out = csr(size, eFrom, indices(edges));
  const inc = csr(size, eTo, indices(edges));
  const rank = new Int32Array(size);

  // Longest path from the root, every edge at least one rank long.
  {
    const done = new Uint8Array(size);
    const cursor = new Int32Array(size);
    const best = new Float64Array(size).fill(Infinity);
    const stack = [root];
    cursor[root] = out.start[root];
    const seen = new Uint8Array(size);
    seen[root] = 1;
    while (stack.length) {
      const v = stack[stack.length - 1];
      if (cursor[v] < out.start[v + 1]) {
        const w = eTo[out.items[cursor[v]++]];
        if (done[w]) best[v] = Math.min(best[v], rank[w] - 1);
        else if (!seen[w]) {
          seen[w] = 1;
          cursor[w] = out.start[w];
          stack.push(w);
        }
      } else {
        stack.pop();
        rank[v] = best[v] === Infinity ? 0 : best[v];
        done[v] = 1;
        const parent = stack[stack.length - 1];
        if (parent !== undefined) best[parent] = Math.min(best[parent], rank[v] - 1);
      }
    }
  }

  const slack = (e: number) => rank[eTo[e]] - rank[eFrom[e]] - 1;

  // Feasible tree: grow a tree of tight edges, shifting it towards the nearest outside node.
  const inTree = new Uint8Array(size);
  const isTreeEdge = new Uint8Array(edges);
  const treeNodes: number[] = [0];
  let treeEdges: number[] = [];
  inTree[0] = 1;
  const grow = () => {
    const snapshot = treeNodes.length;
    const stack: number[] = [];
    for (let i = 0; i < snapshot; i++) {
      stack.push(treeNodes[i]);
      while (stack.length) {
        const v = stack.pop()!;
        for (const list of [inc, out]) {
          for (let k = list.start[v]; k < list.start[v + 1]; k++) {
            const e = list.items[k];
            const w = eFrom[e] === v ? eTo[e] : eFrom[e];
            if (!inTree[w] && slack(e) === 0) {
              inTree[w] = 1;
              treeNodes.push(w);
              isTreeEdge[e] = 1;
              treeEdges.push(e);
              stack.push(w);
            }
          }
        }
      }
    }
  };
  for (;;) {
    grow();
    if (treeNodes.length >= size) break;
    let best = -1;
    let bestSlack = Infinity;
    for (let e = 0; e < edges; e++) {
      if (inTree[eFrom[e]] !== inTree[eTo[e]]) {
        const s = slack(e);
        if (s < bestSlack) {
          bestSlack = s;
          best = e;
        }
      }
    }
    if (best < 0) break;
    const delta = inTree[eFrom[best]] ? bestSlack : -bestSlack;
    for (const v of treeNodes) rank[v] += delta;
  }

  if (!tight) {
    // Network simplex: swap tree edges with negative cut values for the tightest replacement.
    const low = new Int32Array(size);
    const lim = new Int32Array(size);
    const parentEdge = new Int32Array(size);
    const cut = new Float64Array(edges);
    const byLim = new Int32Array(size);
    const pre: number[] = [];
    const treeAdjStart = new Int32Array(size + 1);
    const treeAdj = new Int32Array(2 * size);

    const relabel = () => {
      treeAdjStart.fill(0);
      for (const e of treeEdges) {
        treeAdjStart[eFrom[e] + 1]++;
        treeAdjStart[eTo[e] + 1]++;
      }
      for (let i = 0; i < size; i++) treeAdjStart[i + 1] += treeAdjStart[i];
      const fill = treeAdjStart.slice(0, size);
      for (const e of treeEdges) {
        treeAdj[fill[eFrom[e]]++] = e;
        treeAdj[fill[eTo[e]]++] = e;
      }
      // Low/lim numbering from node 0; lim order is the post-order.
      pre.length = 0;
      const visited = new Uint8Array(size);
      const cursor = new Int32Array(size);
      const stack = [0];
      visited[0] = 1;
      parentEdge[0] = -1;
      cursor[0] = treeAdjStart[0];
      low[0] = 1;
      pre.push(0);
      let nextLim = 1;
      while (stack.length) {
        const v = stack[stack.length - 1];
        if (cursor[v] < treeAdjStart[v + 1]) {
          const e = treeAdj[cursor[v]++];
          const w = eFrom[e] === v ? eTo[e] : eFrom[e];
          if (!visited[w]) {
            visited[w] = 1;
            parentEdge[w] = e;
            low[w] = nextLim;
            cursor[w] = treeAdjStart[w];
            pre.push(w);
            stack.push(w);
          }
        } else {
          lim[v] = nextLim;
          byLim[nextLim - 1] = v;
          nextLim++;
          stack.pop();
        }
      }
      // Cut values bottom-up.
      for (let i = 0; i < size - 1; i++) {
        const child = byLim[i];
        const pe = parentEdge[child];
        const parent = eFrom[pe] === child ? eTo[pe] : eFrom[pe];
        const childIsTail = eFrom[pe] === child;
        let value = eWeight[pe];
        for (const list of [inc, out]) {
          for (let k = list.start[child]; k < list.start[child + 1]; k++) {
            const e = list.items[k];
            const isOut = eFrom[e] === child;
            const other = isOut ? eTo[e] : eFrom[e];
            if (other === parent) continue;
            const pointsToHead = isOut === childIsTail;
            value += pointsToHead ? eWeight[e] : -eWeight[e];
            if (isTreeEdge[e]) value += pointsToHead ? -cut[e] : cut[e];
          }
        }
        cut[pe] = value;
      }
    };

    relabel();
    for (;;) {
      let leave = -1;
      for (const e of treeEdges) {
        if (cut[e] < 0) {
          leave = e;
          break;
        }
      }
      if (leave < 0) break;
      let tail = eFrom[leave];
      let flip = false;
      if (lim[eFrom[leave]] > lim[eTo[leave]]) {
        tail = eTo[leave];
        flip = true;
      }
      const tLow = low[tail];
      const tLim = lim[tail];
      const under = (v: number) => tLow <= lim[v] && lim[v] <= tLim;
      let enter = -1;
      let enterSlack = Infinity;
      for (let e = 0; e < edges; e++) {
        if (flip === under(eFrom[e]) && flip !== under(eTo[e])) {
          const s = slack(e);
          if (enter < 0 || s < enterSlack) {
            enter = e;
            enterSlack = s;
          }
        }
      }
      isTreeEdge[leave] = 0;
      isTreeEdge[enter] = 1;
      treeEdges = treeEdges.filter((e) => e !== leave);
      treeEdges.push(enter);
      relabel();
      for (let i = 1; i < pre.length; i++) {
        const v = pre[i];
        const pe = parentEdge[v];
        rank[v] = eFrom[pe] === v ? rank[eTo[pe]] - 1 : rank[eFrom[pe]] + 1;
      }
    }
  }

  let min = Infinity;
  for (let v = 0; v < n; v++) min = Math.min(min, rank[v]);
  const result = new Int32Array(n);
  for (let v = 0; v < n; v++) result[v] = rank[v] - min;
  return result;
}

interface Entry {
  v: number;
  i: number;
  barycenter: number;
  weight: number;
  sortable: boolean;
}

function orderNodes(
  total: number,
  rank: number[],
  maxRank: number,
  lFrom: number[],
  lTo: number[],
  lWeight: number[],
  succ: Csr,
  pred: Csr,
  order: Int32Array,
): number[][] {
  // Nodes of each rank in graph order: that order breaks ties and places unconnected nodes.
  const members: number[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (let v = 0; v < total; v++) members[rank[v]].push(v);

  // Initial order: DFS from nodes taken by rank.
  let layering: number[][] = Array.from({ length: maxRank + 1 }, () => []);
  {
    const byRank = [...members].flat();
    const visited = new Uint8Array(total);
    const cursor = new Int32Array(total);
    const stack: number[] = [];
    for (const s of byRank) {
      if (visited[s]) continue;
      visited[s] = 1;
      layering[rank[s]].push(s);
      cursor[s] = succ.start[s];
      stack.push(s);
      while (stack.length) {
        const v = stack[stack.length - 1];
        if (cursor[v] < succ.start[v + 1]) {
          const w = lTo[succ.items[cursor[v]++]];
          if (!visited[w]) {
            visited[w] = 1;
            layering[rank[w]].push(w);
            cursor[w] = succ.start[w];
            stack.push(w);
          }
        } else stack.pop();
      }
    }
  }
  const assign = (layers: number[][]) => {
    for (const layer of layers) layer.forEach((v, i) => (order[v] = i));
  };
  assign(layering);

  const sweep = (down: boolean, switchBias: boolean) => {
    let biasRight = true;
    const ranks = down ? range(1, maxRank + 1) : range(maxRank - 1, -1, -1);
    for (const r of ranks) {
      const list = down ? pred : succ;
      const entries: Entry[] = members[r].map((v, i) => {
        let sum = 0;
        let weight = 0;
        for (let k = list.start[v]; k < list.start[v + 1]; k++) {
          const e = list.items[k];
          const u = down ? lFrom[e] : lTo[e];
          sum += lWeight[e] * order[u];
          weight += lWeight[e];
        }
        return weight ? { v, i, barycenter: sum / weight, weight, sortable: true } : { v, i, barycenter: 0, weight: 0, sortable: false };
      });

      // Dagre flips the bias only when equal, non-zero barycenters made it matter.
      let usedBias = false;
      const values = entries.filter((entry) => entry.sortable && entry.barycenter).map((entry) => entry.barycenter);
      values.sort((a, b) => a - b);
      for (let k = 1; k < values.length && !usedBias; k++) usedBias = values[k] === values[k - 1];

      const sortable = entries.filter((entry) => entry.sortable);
      const unsortable = entries.filter((entry) => !entry.sortable).sort((a, b) => b.i - a.i);
      sortable.sort((a, b) => a.barycenter - b.barycenter || (biasRight ? b.i - a.i : a.i - b.i));
      const result: number[] = [];
      const consume = () => {
        while (unsortable.length && unsortable[unsortable.length - 1].i <= result.length) result.push(unsortable.pop()!.v);
      };
      consume();
      for (const entry of sortable) {
        result.push(entry.v);
        consume();
      }
      while (unsortable.length) result.push(unsortable.pop()!.v);
      result.forEach((v, i) => (order[v] = i));
      if (switchBias && usedBias) biasRight = !biasRight;
    }
  };

  const crossings = (layers: number[][]) => {
    let cc = 0;
    for (let r = 1; r < layers.length; r++) {
      const south = layers[r];
      let first = 1;
      while (first < south.length) first <<= 1;
      const tree = new Float64Array(2 * first - 1);
      first -= 1;
      for (const v of layers[r - 1]) {
        const entries: [number, number][] = [];
        for (let k = succ.start[v]; k < succ.start[v + 1]; k++) {
          const e = succ.items[k];
          entries.push([order[lTo[e]], lWeight[e]]);
        }
        entries.sort((a, b) => a[0] - b[0]);
        for (const [pos, weight] of entries) {
          let index = pos + first;
          tree[index] += weight;
          let sum = 0;
          while (index > 0) {
            if (index % 2) sum += tree[index + 1];
            index = (index - 1) >> 1;
            tree[index] += weight;
          }
          cc += weight * sum;
        }
      }
    }
    return cc;
  };

  const current = () => {
    const layers: number[][] = Array.from({ length: maxRank + 1 }, () => []);
    for (let v = 0; v < total; v++) layers[rank[v]][order[v]] = v;
    return layers;
  };

  /** Weighted crossings between the edges of `a` and `b` if `a` stands left of `b`, on both sides of their rank. */
  const pairCrossings = (a: number, b: number) => {
    let count = 0;
    for (const [list, ends] of [[pred, lFrom], [succ, lTo]] as const) {
      for (let i = list.start[a]; i < list.start[a + 1]; i++) {
        const ea = list.items[i];
        const pa = order[ends[ea]];
        for (let j = list.start[b]; j < list.start[b + 1]; j++) {
          const eb = list.items[j];
          if (order[ends[eb]] < pa) count += lWeight[ea] * lWeight[eb];
        }
      }
    }
    return count;
  };

  // Barycenters move whole groups; swapping neighbours then removes the crossings they leave behind.
  const transpose = (layers: number[][]) => {
    for (let round = 0, improved = true; improved && round < 4; round++) {
      improved = false;
      for (const layer of layers) {
        for (let i = 0; i + 1 < layer.length; i++) {
          const v = layer[i];
          const w = layer[i + 1];
          if (pairCrossings(w, v) < pairCrossings(v, w)) {
            layer[i] = w;
            layer[i + 1] = v;
            order[w] = i;
            order[v] = i + 1;
            improved = true;
          }
        }
      }
    }
  };

  let best = layering;
  let bestCC = Infinity;
  for (let i = 0, lastBest = 0; lastBest < 4 && i < 32; i++, lastBest++) {
    sweep(i % 2 === 1, i % 4 >= 2);
    layering = current();
    transpose(layering);
    const cc = crossings(layering);
    if (cc < bestCC) {
      lastBest = 0;
      bestCC = cc;
      best = layering;
    } else if (cc === bestCC) best = layering;
  }
  assign(best);
  return best;
}

function range(start: number, end: number, step = 1) {
  const out: number[] = [];
  for (let i = start; step > 0 ? i < end : i > end; i += step) out.push(i);
  return out;
}

function positionX(
  total: number,
  real: number,
  layering: number[][],
  order: Int32Array,
  width: number[],
  succ: Csr,
  pred: Csr,
  lFrom: number[],
  lTo: number[],
): Float64Array {
  const dummy = (v: number) => v >= real;
  const key = (a: number, b: number) => (a < b ? a * total + b : b * total + a);

  // Type 1 conflicts: a real edge crossing an inner segment between two dummies.
  const conflicts = new Set<number>();
  for (let r = 1; r < layering.length; r++) {
    const prevLength = layering[r - 1].length;
    const layer = layering[r];
    let k0 = 0;
    let scanPos = 0;
    for (let i = 0; i < layer.length; i++) {
      const v = layer[i];
      let w = -1;
      if (dummy(v)) {
        for (let k = pred.start[v]; k < pred.start[v + 1]; k++) {
          const u = lFrom[pred.items[k]];
          if (dummy(u)) {
            w = u;
            break;
          }
        }
      }
      const k1 = w >= 0 ? order[w] : prevLength;
      if (w >= 0 || i === layer.length - 1) {
        for (let s = scanPos; s <= i; s++) {
          const scanNode = layer[s];
          for (let k = pred.start[scanNode]; k < pred.start[scanNode + 1]; k++) {
            const u = lFrom[pred.items[k]];
            const uPos = order[u];
            if ((uPos < k0 || k1 < uPos) && !(dummy(u) && dummy(scanNode))) conflicts.add(key(u, scanNode));
          }
        }
        scanPos = i + 1;
        k0 = k1;
      }
    }
  }

  const pos = new Int32Array(total);
  const root = new Int32Array(total);
  const align = new Int32Array(total);
  const xss: Float64Array[] = [];

  for (const vert of ["u", "d"]) {
    for (const horiz of ["l", "r"]) {
      let layers = vert === "u" ? layering : [...layering].reverse();
      if (horiz === "r") layers = layers.map((layer) => [...layer].reverse());
      const neighbours = vert === "u" ? pred : succ;
      const ends = vert === "u" ? lFrom : lTo;

      for (const layer of layers) {
        layer.forEach((v, i) => {
          root[v] = v;
          align[v] = v;
          pos[v] = i;
        });
      }
      // Vertical alignment with the median neighbours.
      for (const layer of layers) {
        let prevIdx = -1;
        for (const v of layer) {
          const ws: number[] = [];
          for (let k = neighbours.start[v]; k < neighbours.start[v + 1]; k++) ws.push(ends[neighbours.items[k]]);
          if (!ws.length) continue;
          ws.sort((a, b) => pos[a] - pos[b]);
          const mp = (ws.length - 1) / 2;
          for (let i = Math.floor(mp), il = Math.ceil(mp); i <= il; i++) {
            const w = ws[i];
            if (align[v] === v && prevIdx < pos[w] && !conflicts.has(key(v, w))) {
              align[w] = v;
              align[v] = root[v] = root[w];
              prevIdx = pos[w];
            }
          }
        }
      }

      // Horizontal compaction over the block graph.
      const blockEdges = new Map<number, number>();
      const blockOrder: number[] = [];
      const isBlock = new Uint8Array(total);
      for (const layer of layers) {
        let u = -1;
        for (const v of layer) {
          const rv = root[v];
          if (!isBlock[rv]) {
            isBlock[rv] = 1;
            blockOrder.push(rv);
          }
          if (u >= 0) {
            const ru = root[u];
            const sep = width[v] / 2 + (dummy(v) ? EDGESEP : NODESEP) / 2 + (dummy(u) ? EDGESEP : NODESEP) / 2 + width[u] / 2;
            const k = ru * total + rv;
            blockEdges.set(k, Math.max(sep, blockEdges.get(k) ?? 0));
          }
          u = v;
        }
      }
      const bFrom: number[] = [];
      const bTo: number[] = [];
      const bWeight: number[] = [];
      for (const [k, w] of blockEdges) {
        bFrom.push(Math.floor(k / total));
        bTo.push(k % total);
        bWeight.push(w);
      }
      const bOut = csr(total, bFrom, indices(bFrom.length));
      const bIn = csr(total, bTo, indices(bTo.length));
      // Topological order of blocks.
      const indegree = new Int32Array(total);
      for (const t of bTo) indegree[t]++;
      const topo: number[] = [];
      for (const b of blockOrder) if (!indegree[b]) topo.push(b);
      for (let i = 0; i < topo.length; i++) {
        const b = topo[i];
        for (let k = bOut.start[b]; k < bOut.start[b + 1]; k++) {
          const e = bOut.items[k];
          if (--indegree[bTo[e]] === 0) topo.push(bTo[e]);
        }
      }
      const xs = new Float64Array(total);
      for (const b of topo) {
        let value = 0;
        for (let k = bIn.start[b]; k < bIn.start[b + 1]; k++) {
          const e = bIn.items[k];
          value = Math.max(value, xs[bFrom[e]] + bWeight[e]);
        }
        xs[b] = value;
      }
      for (let i = topo.length - 1; i >= 0; i--) {
        const b = topo[i];
        let min = Infinity;
        for (let k = bOut.start[b]; k < bOut.start[b + 1]; k++) {
          const e = bOut.items[k];
          min = Math.min(min, xs[bTo[e]] - bWeight[e]);
        }
        if (min !== Infinity) xs[b] = Math.max(xs[b], min);
      }
      const result = new Float64Array(total);
      for (let v = 0; v < total; v++) result[v] = horiz === "r" ? -xs[root[v]] : xs[root[v]];
      xss.push(result);
    }
  }

  // Align to the narrowest of the four, then take the average median.
  let narrowest = 0;
  let narrowestWidth = Infinity;
  xss.forEach((xs, i) => {
    let max = -Infinity;
    let min = Infinity;
    for (let v = 0; v < total; v++) {
      max = Math.max(max, xs[v] + width[v] / 2);
      min = Math.min(min, xs[v] - width[v] / 2);
    }
    if (max - min < narrowestWidth) {
      narrowestWidth = max - min;
      narrowest = i;
    }
  });
  const extent = (xs: Float64Array) => {
    let min = Infinity;
    let max = -Infinity;
    for (let v = 0; v < total; v++) {
      min = Math.min(min, xs[v]);
      max = Math.max(max, xs[v]);
    }
    return [min, max];
  };
  const [alignMin, alignMax] = extent(xss[narrowest]);
  xss.forEach((xs, i) => {
    if (i === narrowest) return;
    const [min, max] = extent(xs);
    const delta = i % 2 === 0 ? alignMin - min : alignMax - max;
    if (delta) for (let v = 0; v < total; v++) xs[v] += delta;
  });
  const x = new Float64Array(total);
  const four = new Float64Array(4);
  for (let v = 0; v < total; v++) {
    for (let i = 0; i < 4; i++) four[i] = xss[i][v];
    four.sort();
    x[v] = (four[1] + four[2]) / 2;
  }
  return x;
}
