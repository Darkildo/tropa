//! The WebAssembly interface: plain exports over linear memory, no generated glue. The caller
//! (`src/core/layout-wasm.ts`) asks for an input buffer, writes the arrays into it, runs the
//! layout and copies the output arrays out before the next call.

use crate::{sugiyama, Input, Output};
use std::cell::RefCell;

#[derive(Default)]
struct State {
    /// width and height as f64, then from, to, weight, soft_from and soft_to as u32.
    input: Vec<u64>,
    sizes: [usize; 3],
    output: Option<Output>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

/// Room for `n` nodes, `m` ranked edges and `s` soft links: returns where to write them,
/// width (f64 × n), height (f64 × n), then from, to, weight (u32 × m), soft_from, soft_to (u32 × s).
#[no_mangle]
pub extern "C" fn tropa_input(n: u32, m: u32, s: u32) -> *mut u8 {
    let (n, m, s) = (n as usize, m as usize, s as usize);
    STATE.with_borrow_mut(|state| {
        let words = 2 * n + (3 * m + 2 * s).div_ceil(2);
        state.input.clear();
        state.input.resize(words, 0);
        state.sizes = [n, m, s];
        state.output = None;
        state.input.as_mut_ptr() as *mut u8
    })
}

/// Lays out what `tropa_input` received; the output stays until the next call.
#[no_mangle]
pub extern "C" fn tropa_layout(tight: u32) {
    STATE.with_borrow_mut(|state| {
        let [n, m, s] = state.sizes;
        let base = state.input.as_ptr() as *const u8;
        // SAFETY: `tropa_input` sized the buffer for exactly these arrays, f64 first, so every
        // slice is aligned and in bounds; the caller wrote all of them.
        let output = unsafe {
            let f64s = |offset: usize, len: usize| std::slice::from_raw_parts(base.add(offset) as *const f64, len);
            let u32s = |offset: usize, len: usize| std::slice::from_raw_parts(base.add(offset) as *const u32, len);
            let ints = 16 * n;
            sugiyama(&Input {
                width: f64s(0, n),
                height: f64s(8 * n, n),
                from: u32s(ints, m),
                to: u32s(ints + 4 * m, m),
                weight: u32s(ints + 8 * m, m),
                soft_from: u32s(ints + 12 * m, s),
                soft_to: u32s(ints + 12 * m + 4 * s, s),
                tight: tight != 0,
            })
        };
        state.output = Some(output);
    });
}

/// Where output array `which` starts: 0 x, 1 y (f64), 2 path starts (u32), 3 path points (f64).
#[no_mangle]
pub extern "C" fn tropa_output(which: u32) -> *const u8 {
    STATE.with_borrow(|state| match (&state.output, which) {
        (Some(out), 0) => out.x.as_ptr() as *const u8,
        (Some(out), 1) => out.y.as_ptr() as *const u8,
        (Some(out), 2) => out.path_start.as_ptr() as *const u8,
        (Some(out), 3) => out.path_points.as_ptr() as *const u8,
        _ => std::ptr::null(),
    })
}

/// How many elements output array `which` has.
#[no_mangle]
pub extern "C" fn tropa_output_len(which: u32) -> u32 {
    STATE.with_borrow(|state| match (&state.output, which) {
        (Some(out), 0) => out.x.len() as u32,
        (Some(out), 1) => out.y.len() as u32,
        (Some(out), 2) => out.path_start.len() as u32,
        (Some(out), 3) => out.path_points.len() as u32,
        _ => 0,
    })
}
