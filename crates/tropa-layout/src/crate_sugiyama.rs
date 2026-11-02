//! The `rust-sugiyama` crate behind the same flat interface. It returns node centres only (no
//! bend points, no edge weights) and lays out each connected component on its own, so the
//! components are packed left to right and ranks are re-spaced to Tropa's rank gap.

use super::{Output, NODESEP, RANKSEP};
use rust_sugiyama::configure::Config;
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

pub fn layout_crate(width: &[f64], height: &[f64], from: &[u32], to: &[u32]) -> Output {
    let n = width.len();
    let vertices: Vec<(u32, (f64, f64))> = (0..n).map(|v| (v as u32, (width[v], height[v]))).collect();
    let edges: Vec<(u32, u32)> = from.iter().zip(to).map(|(&a, &b)| (a, b)).collect();
    let config = Config { vertex_spacing: NODESEP, ..Default::default() };
    let components = rust_sugiyama::from_vertices_and_edges(&vertices, &edges, &config);

    let mut x = vec![0.0f64; n];
    let mut raw_y = vec![0.0f64; n];
    let mut placed = vec![false; n];
    let mut offset = 0.0f64;
    for (coords, _, _) in &components {
        let mut left = f64::INFINITY;
        let mut right = f64::NEG_INFINITY;
        for &(id, (cx, _)) in coords {
            if id < n {
                left = left.min(cx - width[id] / 2.0);
                right = right.max(cx + width[id] / 2.0);
            }
        }
        if left == f64::INFINITY {
            continue;
        }
        for &(id, (cx, cy)) in coords {
            if id < n {
                x[id] = cx - left + offset;
                raw_y[id] = cy;
                placed[id] = true;
            }
        }
        offset += right - left + NODESEP;
    }
    // Isolated nodes the crate skips.
    for v in 0..n {
        if !placed[v] {
            x[v] = offset + width[v] / 2.0;
            offset += width[v] + NODESEP;
        }
    }

    // Ranks by their centre line, then Tropa's spacing.
    let mut ranks: BTreeMap<i64, f64> = BTreeMap::new();
    for v in 0..n {
        let max = ranks.entry(raw_y[v].round() as i64).or_insert(0.0);
        *max = max.max(height[v]);
    }
    let mut centre: BTreeMap<i64, f64> = BTreeMap::new();
    let mut top = 0.0;
    for (&key, &max) in &ranks {
        centre.insert(key, top + max / 2.0);
        top += max + RANKSEP;
    }
    let y = (0..n).map(|v| centre[&(raw_y[v].round() as i64)]).collect();
    Output { x, y, inner: vec![Vec::new(); from.len()] }
}

#[wasm_bindgen]
pub fn layout_crate_sugiyama(width: &[f64], height: &[f64], from: &[u32], to: &[u32]) -> Vec<f64> {
    layout_crate(width, height, from, to).flatten()
}
