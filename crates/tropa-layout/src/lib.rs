//! Layered layout for Tropa: a line-by-line port of `bench/sugi.ts`, so the benchmark compares
//! languages rather than algorithms. Dagre's pipeline without its label ranks: DFS cycle
//! breaking, network simplex (or tight tree) ranking, dummy chains, barycenter sweeps with
//! dagre's tie rules, Brandes–Köpf coordinates.

use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

#[cfg(feature = "crate-sugiyama")]
pub mod crate_sugiyama;

const NODESEP: f64 = 40.0;
const EDGESEP: f64 = 18.0;
const RANKSEP: f64 = 64.0;

pub struct Input<'a> {
    pub width: &'a [f64],
    pub height: &'a [f64],
    pub from: &'a [u32],
    pub to: &'a [u32],
    pub weight: &'a [u32],
    pub tight: bool,
}

pub struct Output {
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    /// Bend points per input edge, flattened as x, y pairs.
    pub inner: Vec<Vec<f64>>,
}

impl Output {
    /// `[x…, y…, then per edge: point count, x, y, x, y…]`.
    pub fn flatten(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.x.len() * 2 + self.inner.iter().map(|p| p.len() + 1).sum::<usize>());
        out.extend_from_slice(&self.x);
        out.extend_from_slice(&self.y);
        for points in &self.inner {
            out.push((points.len() / 2) as f64);
            out.extend_from_slice(points);
        }
        out
    }
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance)]
    fn now() -> f64;
}

/// Lays out the graph. The last element of the result is the time spent inside, in ms.
#[wasm_bindgen]
pub fn layout(width: &[f64], height: &[f64], from: &[u32], to: &[u32], weight: &[u32], tight: bool) -> Vec<f64> {
    #[cfg(target_arch = "wasm32")]
    let start = now();
    let output = sugiyama(&Input { width, height, from, to, weight, tight });
    let mut flat = output.flatten();
    #[cfg(target_arch = "wasm32")]
    flat.push(now() - start);
    #[cfg(not(target_arch = "wasm32"))]
    flat.push(0.0);
    flat
}

struct Csr {
    start: Vec<usize>,
    items: Vec<usize>,
}

impl Csr {
    /// Groups `0..keys.len()` by key, keeping their order inside each group.
    fn new(count: usize, keys: &[usize]) -> Self {
        let mut start = vec![0usize; count + 1];
        for &k in keys {
            start[k + 1] += 1;
        }
        for i in 0..count {
            start[i + 1] += start[i];
        }
        let mut fill = start[..count].to_vec();
        let mut items = vec![0usize; keys.len()];
        for (i, &k) in keys.iter().enumerate() {
            items[fill[k]] = i;
            fill[k] += 1;
        }
        Csr { start, items }
    }

    #[inline]
    fn of(&self, v: usize) -> &[usize] {
        &self.items[self.start[v]..self.start[v + 1]]
    }
}

pub fn sugiyama(input: &Input) -> Output {
    let n = input.width.len();
    let m = input.from.len();
    if n == 0 {
        return Output { x: vec![], y: vec![], inner: vec![] };
    }
    let in_from: Vec<usize> = input.from.iter().map(|&v| v as usize).collect();
    let in_to: Vec<usize> = input.to.iter().map(|&v| v as usize).collect();

    // 1. Break cycles: reverse the edges that point back into the DFS stack.
    let mut reversed = vec![false; m];
    {
        let out = Csr::new(n, &in_from);
        let mut visited = vec![false; n];
        let mut on_stack = vec![false; n];
        let mut cursor = vec![0usize; n];
        let mut stack: Vec<usize> = Vec::new();
        for s in 0..n {
            if visited[s] {
                continue;
            }
            visited[s] = true;
            on_stack[s] = true;
            cursor[s] = out.start[s];
            stack.push(s);
            while let Some(&v) = stack.last() {
                if cursor[v] < out.start[v + 1] {
                    let e = out.items[cursor[v]];
                    cursor[v] += 1;
                    let w = in_to[e];
                    if on_stack[w] {
                        reversed[e] = true;
                    } else if !visited[w] {
                        visited[w] = true;
                        on_stack[w] = true;
                        cursor[w] = out.start[w];
                        stack.push(w);
                    }
                } else {
                    on_stack[v] = false;
                    stack.pop();
                }
            }
        }
    }

    // Merge edges that now share both ends. Reversed ones go last, as dagre re-adds them.
    let mut merged_of = vec![0usize; m];
    let mut e_from: Vec<usize> = Vec::new();
    let mut e_to: Vec<usize> = Vec::new();
    let mut e_weight: Vec<f64> = Vec::new();
    {
        let mut seen: HashMap<u64, usize> = HashMap::new();
        for pass in [false, true] {
            for e in 0..m {
                if reversed[e] != pass {
                    continue;
                }
                let (u, v) = if pass { (in_to[e], in_from[e]) } else { (in_from[e], in_to[e]) };
                let k = *seen.entry(u as u64 * n as u64 + v as u64).or_insert_with(|| {
                    e_from.push(u);
                    e_to.push(v);
                    e_weight.push(0.0);
                    e_from.len() - 1
                });
                e_weight[k] += input.weight[e] as f64;
                merged_of[e] = k;
            }
        }
    }
    let merged = e_from.len();

    // 2. Ranks.
    let rank = rank_nodes(n, &e_from, &e_to, &e_weight, input.tight);

    // 3. Dummy chains for edges longer than one rank.
    let mut node_rank: Vec<usize> = rank.clone();
    let mut node_width: Vec<f64> = input.width.to_vec();
    let mut node_height: Vec<f64> = input.height.to_vec();
    let mut chains: Vec<Vec<usize>> = Vec::with_capacity(merged);
    let mut l_from: Vec<usize> = Vec::new();
    let mut l_to: Vec<usize> = Vec::new();
    let mut l_weight: Vec<f64> = Vec::new();
    for k in 0..merged {
        let mut chain = Vec::new();
        let mut prev = e_from[k];
        for r in rank[e_from[k]] + 1..rank[e_to[k]] {
            let d = node_rank.len();
            node_rank.push(r);
            node_width.push(0.0);
            node_height.push(0.0);
            chain.push(d);
            l_from.push(prev);
            l_to.push(d);
            l_weight.push(e_weight[k]);
            prev = d;
        }
        l_from.push(prev);
        l_to.push(e_to[k]);
        l_weight.push(e_weight[k]);
        chains.push(chain);
    }
    let total = node_rank.len();
    let succ = Csr::new(total, &l_from);
    let pred = Csr::new(total, &l_to);
    let max_rank = node_rank.iter().copied().max().unwrap_or(0);

    // 4. Order inside ranks.
    let mut order = vec![0usize; total];
    let layering = order_nodes(total, &node_rank, max_rank, &l_from, &l_to, &l_weight, &succ, &pred, &mut order);

    // 5. Coordinates.
    let x = position_x(total, n, &layering, &order, &node_width, &succ, &pred, &l_from, &l_to);
    let mut y = vec![0.0f64; total];
    let mut rank_height = vec![0.0f64; layering.len()];
    let mut prev_y = 0.0;
    for (r, layer) in layering.iter().enumerate() {
        let max_height = layer.iter().fold(0.0f64, |acc, &v| acc.max(node_height[v]));
        for &v in layer {
            y[v] = prev_y + max_height / 2.0;
        }
        rank_height[r] = max_height;
        prev_y += max_height + RANKSEP;
    }

    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    for v in 0..n {
        min_x = min_x.min(x[v] - node_width[v] / 2.0);
        min_y = min_y.min(y[v] - node_height[v] / 2.0);
    }

    let mut inner = Vec::with_capacity(m);
    for e in 0..m {
        // Each dummy crosses its rank straight down, so the curve clears the nodes beside it.
        let chain = &chains[merged_of[e]];
        let mut points: Vec<[f64; 2]> = Vec::with_capacity(chain.len() * 2);
        for &d in chain {
            let half = rank_height[node_rank[d]] / 2.0;
            points.push([x[d] - min_x, y[d] - half - min_y]);
            points.push([x[d] - min_x, y[d] + half - min_y]);
        }
        if reversed[e] {
            points.reverse();
        }
        inner.push(points.into_iter().flatten().collect());
    }
    Output {
        x: (0..n).map(|v| x[v] - min_x).collect(),
        y: (0..n).map(|v| y[v] - min_y).collect(),
        inner,
    }
}

fn rank_nodes(n: usize, from: &[usize], to: &[usize], weight: &[f64], tight: bool) -> Vec<usize> {
    let root = n;
    let size = n + 1;
    let mut e_from = from.to_vec();
    let mut e_to = to.to_vec();
    let mut e_weight = weight.to_vec();
    for v in 0..n {
        e_from.push(root);
        e_to.push(v);
        e_weight.push(0.0);
    }
    let edges = e_from.len();
    let out = Csr::new(size, &e_from);
    let inc = Csr::new(size, &e_to);
    let mut rank = vec![0i64; size];

    // Longest path from the root, every edge at least one rank long.
    {
        let mut done = vec![false; size];
        let mut seen = vec![false; size];
        let mut cursor = vec![0usize; size];
        let mut best = vec![i64::MAX; size];
        let mut stack = vec![root];
        seen[root] = true;
        cursor[root] = out.start[root];
        while let Some(&v) = stack.last() {
            if cursor[v] < out.start[v + 1] {
                let w = e_to[out.items[cursor[v]]];
                cursor[v] += 1;
                if done[w] {
                    best[v] = best[v].min(rank[w] - 1);
                } else if !seen[w] {
                    seen[w] = true;
                    cursor[w] = out.start[w];
                    stack.push(w);
                }
            } else {
                stack.pop();
                rank[v] = if best[v] == i64::MAX { 0 } else { best[v] };
                done[v] = true;
                if let Some(&parent) = stack.last() {
                    best[parent] = best[parent].min(rank[v] - 1);
                }
            }
        }
    }

    let slack = |rank: &[i64], e: usize| rank[e_to[e]] - rank[e_from[e]] - 1;

    // Feasible tree: grow a tree of tight edges, shifting it towards the nearest outside node.
    let mut in_tree = vec![false; size];
    let mut is_tree_edge = vec![false; edges];
    let mut tree_nodes: Vec<usize> = vec![0];
    let mut tree_edges: Vec<usize> = Vec::new();
    in_tree[0] = true;
    loop {
        let snapshot = tree_nodes.len();
        let mut stack: Vec<usize> = Vec::new();
        for i in 0..snapshot {
            stack.push(tree_nodes[i]);
            while let Some(v) = stack.pop() {
                for list in [&inc, &out] {
                    for &e in list.of(v) {
                        let w = if e_from[e] == v { e_to[e] } else { e_from[e] };
                        if !in_tree[w] && slack(&rank, e) == 0 {
                            in_tree[w] = true;
                            tree_nodes.push(w);
                            is_tree_edge[e] = true;
                            tree_edges.push(e);
                            stack.push(w);
                        }
                    }
                }
            }
        }
        if tree_nodes.len() >= size {
            break;
        }
        let mut best: Option<usize> = None;
        let mut best_slack = i64::MAX;
        for e in 0..edges {
            if in_tree[e_from[e]] != in_tree[e_to[e]] {
                let s = slack(&rank, e);
                if s < best_slack {
                    best_slack = s;
                    best = Some(e);
                }
            }
        }
        let Some(best) = best else { break };
        let delta = if in_tree[e_from[best]] { best_slack } else { -best_slack };
        for &v in &tree_nodes {
            rank[v] += delta;
        }
    }

    if !tight {
        // Network simplex: swap tree edges with negative cut values for the tightest replacement.
        let mut low = vec![0usize; size];
        let mut lim = vec![0usize; size];
        let mut parent_edge = vec![usize::MAX; size];
        let mut cut = vec![0.0f64; edges];
        let mut by_lim = vec![0usize; size];
        let mut pre: Vec<usize> = Vec::with_capacity(size);
        let mut tree_adj_start = vec![0usize; size + 1];
        let mut tree_adj = vec![0usize; 2 * size];
        let mut visited = vec![false; size];
        let mut cursor = vec![0usize; size];

        let mut relabel = |tree_edges: &[usize],
                           is_tree_edge: &[bool],
                           low: &mut [usize],
                           lim: &mut [usize],
                           parent_edge: &mut [usize],
                           cut: &mut [f64],
                           pre: &mut Vec<usize>| {
            tree_adj_start.iter_mut().for_each(|s| *s = 0);
            for &e in tree_edges {
                tree_adj_start[e_from[e] + 1] += 1;
                tree_adj_start[e_to[e] + 1] += 1;
            }
            for i in 0..size {
                tree_adj_start[i + 1] += tree_adj_start[i];
            }
            let mut fill = tree_adj_start[..size].to_vec();
            for &e in tree_edges {
                tree_adj[fill[e_from[e]]] = e;
                fill[e_from[e]] += 1;
                tree_adj[fill[e_to[e]]] = e;
                fill[e_to[e]] += 1;
            }
            // Low/lim numbering from node 0; lim order is the post-order.
            pre.clear();
            visited.iter_mut().for_each(|v| *v = false);
            let mut stack = vec![0usize];
            visited[0] = true;
            parent_edge[0] = usize::MAX;
            cursor[0] = tree_adj_start[0];
            low[0] = 1;
            pre.push(0);
            let mut next_lim = 1usize;
            while let Some(&v) = stack.last() {
                if cursor[v] < tree_adj_start[v + 1] {
                    let e = tree_adj[cursor[v]];
                    cursor[v] += 1;
                    let w = if e_from[e] == v { e_to[e] } else { e_from[e] };
                    if !visited[w] {
                        visited[w] = true;
                        parent_edge[w] = e;
                        low[w] = next_lim;
                        cursor[w] = tree_adj_start[w];
                        pre.push(w);
                        stack.push(w);
                    }
                } else {
                    lim[v] = next_lim;
                    by_lim[next_lim - 1] = v;
                    next_lim += 1;
                    stack.pop();
                }
            }
            // Cut values bottom-up.
            for i in 0..size - 1 {
                let child = by_lim[i];
                let pe = parent_edge[child];
                let parent = if e_from[pe] == child { e_to[pe] } else { e_from[pe] };
                let child_is_tail = e_from[pe] == child;
                let mut value = e_weight[pe];
                for list in [&inc, &out] {
                    for &e in list.of(child) {
                        let is_out = e_from[e] == child;
                        let other = if is_out { e_to[e] } else { e_from[e] };
                        if other == parent {
                            continue;
                        }
                        let points_to_head = is_out == child_is_tail;
                        value += if points_to_head { e_weight[e] } else { -e_weight[e] };
                        if is_tree_edge[e] {
                            value += if points_to_head { -cut[e] } else { cut[e] };
                        }
                    }
                }
                cut[pe] = value;
            }
        };

        relabel(&tree_edges, &is_tree_edge, &mut low, &mut lim, &mut parent_edge, &mut cut, &mut pre);
        loop {
            let Some(&leave) = tree_edges.iter().find(|&&e| cut[e] < 0.0) else { break };
            let (tail, flip) = if lim[e_from[leave]] > lim[e_to[leave]] { (e_to[leave], true) } else { (e_from[leave], false) };
            let (t_low, t_lim) = (low[tail], lim[tail]);
            let under = |v: usize| t_low <= lim[v] && lim[v] <= t_lim;
            let mut enter: Option<usize> = None;
            let mut enter_slack = i64::MAX;
            for e in 0..edges {
                if flip == under(e_from[e]) && flip != under(e_to[e]) {
                    let s = slack(&rank, e);
                    if enter.is_none() || s < enter_slack {
                        enter = Some(e);
                        enter_slack = s;
                    }
                }
            }
            let enter = enter.expect("network simplex: no entering edge");
            is_tree_edge[leave] = false;
            is_tree_edge[enter] = true;
            tree_edges.retain(|&e| e != leave);
            tree_edges.push(enter);
            relabel(&tree_edges, &is_tree_edge, &mut low, &mut lim, &mut parent_edge, &mut cut, &mut pre);
            for &v in &pre[1..] {
                let pe = parent_edge[v];
                rank[v] = if e_from[pe] == v { rank[e_to[pe]] - 1 } else { rank[e_from[pe]] + 1 };
            }
        }
    }

    let min = rank[..n].iter().copied().min().unwrap_or(0);
    rank[..n].iter().map(|&r| (r - min) as usize).collect()
}

struct Entry {
    v: usize,
    i: usize,
    barycenter: f64,
    sortable: bool,
}

#[allow(clippy::too_many_arguments)]
fn order_nodes(
    total: usize,
    rank: &[usize],
    max_rank: usize,
    l_from: &[usize],
    l_to: &[usize],
    l_weight: &[f64],
    succ: &Csr,
    pred: &Csr,
    order: &mut [usize],
) -> Vec<Vec<usize>> {
    // Nodes of each rank in graph order: that order breaks ties and places unconnected nodes.
    let mut members: Vec<Vec<usize>> = vec![Vec::new(); max_rank + 1];
    for v in 0..total {
        members[rank[v]].push(v);
    }

    // Initial order: DFS from nodes taken by rank.
    let mut layering: Vec<Vec<usize>> = vec![Vec::new(); max_rank + 1];
    {
        let mut visited = vec![false; total];
        let mut cursor = vec![0usize; total];
        let mut stack: Vec<usize> = Vec::new();
        for s in members.iter().flatten().copied() {
            if visited[s] {
                continue;
            }
            visited[s] = true;
            layering[rank[s]].push(s);
            cursor[s] = succ.start[s];
            stack.push(s);
            while let Some(&v) = stack.last() {
                if cursor[v] < succ.start[v + 1] {
                    let w = l_to[succ.items[cursor[v]]];
                    cursor[v] += 1;
                    if !visited[w] {
                        visited[w] = true;
                        layering[rank[w]].push(w);
                        cursor[w] = succ.start[w];
                        stack.push(w);
                    }
                } else {
                    stack.pop();
                }
            }
        }
    }
    let assign = |layers: &[Vec<usize>], order: &mut [usize]| {
        for layer in layers {
            for (i, &v) in layer.iter().enumerate() {
                order[v] = i;
            }
        }
    };
    assign(&layering, order);

    let sweep = |down: bool, switch_bias: bool, order: &mut [usize]| {
        let mut bias_right = true;
        let ranks: Vec<usize> = if down { (1..=max_rank).collect() } else { (0..max_rank).rev().collect() };
        let list = if down { pred } else { succ };
        for r in ranks {
            let mut sortable: Vec<Entry> = Vec::new();
            let mut unsortable: Vec<Entry> = Vec::new();
            for (i, &v) in members[r].iter().enumerate() {
                let mut sum = 0.0;
                let mut weight = 0.0;
                for &e in list.of(v) {
                    let u = if down { l_from[e] } else { l_to[e] };
                    sum += l_weight[e] * order[u] as f64;
                    weight += l_weight[e];
                }
                if weight != 0.0 {
                    sortable.push(Entry { v, i, barycenter: sum / weight, sortable: true });
                } else {
                    unsortable.push(Entry { v, i, barycenter: 0.0, sortable: false });
                }
            }

            // Dagre flips the bias only when equal, non-zero barycenters made it matter.
            let mut values: Vec<f64> = sortable.iter().filter(|e| e.sortable && e.barycenter != 0.0).map(|e| e.barycenter).collect();
            values.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let used_bias = values.windows(2).any(|w| w[0] == w[1]);

            unsortable.sort_by(|a, b| b.i.cmp(&a.i));
            sortable.sort_by(|a, b| {
                a.barycenter.partial_cmp(&b.barycenter).unwrap().then_with(|| if bias_right { b.i.cmp(&a.i) } else { a.i.cmp(&b.i) })
            });
            let mut result: Vec<usize> = Vec::with_capacity(members[r].len());
            let consume = |result: &mut Vec<usize>, unsortable: &mut Vec<Entry>| {
                while let Some(last) = unsortable.last() {
                    if last.i > result.len() {
                        break;
                    }
                    result.push(unsortable.pop().unwrap().v);
                }
            };
            consume(&mut result, &mut unsortable);
            for entry in &sortable {
                result.push(entry.v);
                consume(&mut result, &mut unsortable);
            }
            while let Some(entry) = unsortable.pop() {
                result.push(entry.v);
            }
            for (i, &v) in result.iter().enumerate() {
                order[v] = i;
            }
            if switch_bias && used_bias {
                bias_right = !bias_right;
            }
        }
    };

    let crossings = |layers: &[Vec<usize>], order: &[usize]| -> f64 {
        let mut cc = 0.0;
        let mut entries: Vec<(usize, f64)> = Vec::new();
        for r in 1..layers.len() {
            let south = &layers[r];
            let mut first = 1usize;
            while first < south.len() {
                first <<= 1;
            }
            let mut tree = vec![0.0f64; 2 * first - 1];
            first -= 1;
            for &v in &layers[r - 1] {
                entries.clear();
                for &e in succ.of(v) {
                    entries.push((order[l_to[e]], l_weight[e]));
                }
                entries.sort_by(|a, b| a.0.cmp(&b.0));
                for &(pos, weight) in &entries {
                    let mut index = pos + first;
                    tree[index] += weight;
                    let mut sum = 0.0;
                    while index > 0 {
                        if index % 2 == 1 {
                            sum += tree[index + 1];
                        }
                        index = (index - 1) >> 1;
                        tree[index] += weight;
                    }
                    cc += weight * sum;
                }
            }
        }
        cc
    };

    let current = |order: &[usize]| -> Vec<Vec<usize>> {
        let mut layers: Vec<Vec<usize>> = members.iter().map(|m| vec![0; m.len()]).collect();
        for v in 0..total {
            layers[rank[v]][order[v]] = v;
        }
        layers
    };

    let mut best = layering;
    let mut best_cc = f64::INFINITY;
    let mut i = 0usize;
    let mut last_best = 0usize;
    while last_best < 4 {
        sweep(i % 2 == 1, i % 4 >= 2, order);
        let layers = current(order);
        let cc = crossings(&layers, order);
        if cc < best_cc {
            last_best = 0;
            best_cc = cc;
            best = layers;
        } else if cc == best_cc {
            best = layers;
        }
        i += 1;
        last_best += 1;
    }
    assign(&best, order);
    best
}

#[allow(clippy::too_many_arguments)]
fn position_x(
    total: usize,
    real: usize,
    layering: &[Vec<usize>],
    order: &[usize],
    width: &[f64],
    succ: &Csr,
    pred: &Csr,
    l_from: &[usize],
    l_to: &[usize],
) -> Vec<f64> {
    let dummy = |v: usize| v >= real;
    // u64: on wasm32 a usize product of two node indices overflows.
    let key = |a: usize, b: usize| if a < b { a as u64 * total as u64 + b as u64 } else { b as u64 * total as u64 + a as u64 };

    // Type 1 conflicts: a real edge crossing an inner segment between two dummies.
    let mut conflicts: HashSet<u64> = HashSet::new();
    for r in 1..layering.len() {
        let prev_length = layering[r - 1].len();
        let layer = &layering[r];
        let mut k0 = 0usize;
        let mut scan_pos = 0usize;
        for (i, &v) in layer.iter().enumerate() {
            let mut w: Option<usize> = None;
            if dummy(v) {
                w = pred.of(v).iter().map(|&e| l_from[e]).find(|&u| dummy(u));
            }
            let k1 = w.map(|w| order[w]).unwrap_or(prev_length);
            if w.is_some() || i == layer.len() - 1 {
                for &scan_node in &layer[scan_pos..=i] {
                    for &e in pred.of(scan_node) {
                        let u = l_from[e];
                        let u_pos = order[u];
                        if (u_pos < k0 || k1 < u_pos) && !(dummy(u) && dummy(scan_node)) {
                            conflicts.insert(key(u, scan_node));
                        }
                    }
                }
                scan_pos = i + 1;
                k0 = k1;
            }
        }
    }

    let mut pos = vec![0usize; total];
    let mut root = vec![0usize; total];
    let mut align = vec![0usize; total];
    let mut xss: Vec<Vec<f64>> = Vec::with_capacity(4);

    for vert_up in [true, false] {
        for horiz_right in [false, true] {
            let mut layers: Vec<Vec<usize>> = if vert_up { layering.to_vec() } else { layering.iter().rev().cloned().collect() };
            if horiz_right {
                for layer in layers.iter_mut() {
                    layer.reverse();
                }
            }
            let (neighbours, ends) = if vert_up { (pred, l_from) } else { (succ, l_to) };

            for layer in &layers {
                for (i, &v) in layer.iter().enumerate() {
                    root[v] = v;
                    align[v] = v;
                    pos[v] = i;
                }
            }
            // Vertical alignment with the median neighbours.
            let mut ws: Vec<usize> = Vec::new();
            for layer in &layers {
                let mut prev_idx: isize = -1;
                for &v in layer {
                    ws.clear();
                    ws.extend(neighbours.of(v).iter().map(|&e| ends[e]));
                    if ws.is_empty() {
                        continue;
                    }
                    ws.sort_by_key(|&w| pos[w]);
                    let mp = (ws.len() - 1) as f64 / 2.0;
                    for i in mp.floor() as usize..=mp.ceil() as usize {
                        let w = ws[i];
                        if align[v] == v && prev_idx < pos[w] as isize && !conflicts.contains(&key(v, w)) {
                            align[w] = v;
                            root[v] = root[w];
                            align[v] = root[w];
                            prev_idx = pos[w] as isize;
                        }
                    }
                }
            }

            // Horizontal compaction over the block graph.
            let mut block_edges: HashMap<u64, f64> = HashMap::new();
            let mut block_keys: Vec<u64> = Vec::new();
            let mut block_order: Vec<usize> = Vec::new();
            let mut is_block = vec![false; total];
            for layer in &layers {
                let mut u: Option<usize> = None;
                for &v in layer {
                    let rv = root[v];
                    if !is_block[rv] {
                        is_block[rv] = true;
                        block_order.push(rv);
                    }
                    if let Some(u) = u {
                        let ru = root[u];
                        let sep = width[v] / 2.0
                            + if dummy(v) { EDGESEP } else { NODESEP } / 2.0
                            + if dummy(u) { EDGESEP } else { NODESEP } / 2.0
                            + width[u] / 2.0;
                        let k = ru as u64 * total as u64 + rv as u64;
                        match block_edges.get_mut(&k) {
                            Some(w) => *w = w.max(sep),
                            None => {
                                block_edges.insert(k, sep);
                                block_keys.push(k);
                            }
                        }
                    }
                    u = Some(v);
                }
            }
            let b_from: Vec<usize> = block_keys.iter().map(|k| (k / total as u64) as usize).collect();
            let b_to: Vec<usize> = block_keys.iter().map(|k| (k % total as u64) as usize).collect();
            let b_weight: Vec<f64> = block_keys.iter().map(|k| block_edges[k]).collect();
            let b_out = Csr::new(total, &b_from);
            let b_in = Csr::new(total, &b_to);
            // Topological order of blocks.
            let mut indegree = vec![0usize; total];
            for &t in &b_to {
                indegree[t] += 1;
            }
            let mut topo: Vec<usize> = block_order.iter().copied().filter(|&b| indegree[b] == 0).collect();
            let mut i = 0;
            while i < topo.len() {
                let b = topo[i];
                for &e in b_out.of(b) {
                    indegree[b_to[e]] -= 1;
                    if indegree[b_to[e]] == 0 {
                        topo.push(b_to[e]);
                    }
                }
                i += 1;
            }
            let mut xs = vec![0.0f64; total];
            for &b in &topo {
                let mut value = 0.0f64;
                for &e in b_in.of(b) {
                    value = value.max(xs[b_from[e]] + b_weight[e]);
                }
                xs[b] = value;
            }
            for &b in topo.iter().rev() {
                let mut min = f64::INFINITY;
                for &e in b_out.of(b) {
                    min = min.min(xs[b_to[e]] - b_weight[e]);
                }
                if min != f64::INFINITY {
                    xs[b] = xs[b].max(min);
                }
            }
            xss.push((0..total).map(|v| if horiz_right { -xs[root[v]] } else { xs[root[v]] }).collect());
        }
    }

    // Align to the narrowest of the four, then take the average median.
    let mut narrowest = 0;
    let mut narrowest_width = f64::INFINITY;
    for (i, xs) in xss.iter().enumerate() {
        let mut max = f64::NEG_INFINITY;
        let mut min = f64::INFINITY;
        for v in 0..total {
            max = max.max(xs[v] + width[v] / 2.0);
            min = min.min(xs[v] - width[v] / 2.0);
        }
        if max - min < narrowest_width {
            narrowest_width = max - min;
            narrowest = i;
        }
    }
    let extent = |xs: &[f64]| xs.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &x| (lo.min(x), hi.max(x)));
    let (align_min, align_max) = extent(&xss[narrowest]);
    for i in 0..4 {
        if i == narrowest {
            continue;
        }
        let (min, max) = extent(&xss[i]);
        let delta = if i % 2 == 0 { align_min - min } else { align_max - max };
        if delta != 0.0 {
            xss[i].iter_mut().for_each(|x| *x += delta);
        }
    }
    (0..total)
        .map(|v| {
            let mut four = [xss[0][v], xss[1][v], xss[2][v], xss[3][v]];
            four.sort_by(|a, b| a.partial_cmp(b).unwrap());
            (four[1] + four[2]) / 2.0
        })
        .collect()
}
