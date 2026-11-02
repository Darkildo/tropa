//! Native timing of the same layout, for the WebAssembly overhead.
//! Usage: native dist/bench/inputs/*.txt  →  one JSON line per input.
use std::time::Instant;
use tropa_layout::{sugiyama, Input};

fn numbers<T: std::str::FromStr>(line: &str) -> Vec<T> {
    line.split_whitespace().filter_map(|t| t.parse().ok()).collect()
}

fn main() {
    for path in std::env::args().skip(1) {
        let text = std::fs::read_to_string(&path).expect("read input");
        let lines: Vec<&str> = text.lines().collect();
        let head: Vec<usize> = numbers(lines[0]);
        let width: Vec<f64> = numbers(lines[1]);
        let height: Vec<f64> = numbers(lines[2]);
        let from: Vec<u32> = numbers(lines.get(3).copied().unwrap_or(""));
        let to: Vec<u32> = numbers(lines.get(4).copied().unwrap_or(""));
        let weight: Vec<u32> = numbers(lines.get(5).copied().unwrap_or(""));
        let input = Input { width: &width, height: &height, from: &from, to: &to, weight: &weight, tight: head[2] == 1 };
        for _ in 0..2 {
            sugiyama(&input);
        }
        let mut times: Vec<f64> = (0..7)
            .map(|_| {
                let t = Instant::now();
                std::hint::black_box(sugiyama(&input));
                t.elapsed().as_secs_f64() * 1000.0
            })
            .collect();
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let name = path.rsplit('/').next().unwrap().trim_end_matches(".txt");
        println!("{{\"case\":\"{}\",\"nodes\":{},\"median\":{:.3},\"p95\":{:.3}}}", name, head[0], times[3], times[6]);
    }
}
