import { describe, expect, it } from "vitest";
import { computeRoute, computeStates, emptyProgress, LearningGraph } from "../src/core/graph";
import { layoutGraph, prepareLayout, svgPaths } from "../src/core/layout";
import { ENGINES, type EngineInput } from "../src/core/layout-engine";
import { LayoutRunner, WORKER_FROM, shapeKey, type LayoutReply, type LayoutRequest, type LayoutWorker } from "../src/core/layout-runner";
import { generate } from "../bench/gen";
import { polyline, quality } from "../bench/metrics";

const big = new LearningGraph(generate(200, true));

describe("layout engine", () => {
  const layout = layoutGraph(big, { showSources: true });

  it("never overlaps nodes", () => {
    const list = [...layout.nodes.values()].sort((a, b) => a.y - b.y || a.x - b.x);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].y < list[i].y + list[i].height; j++) {
        const [a, b] = [list[i], list[j]];
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x).toBe(true);
      }
    }
  });

  it("draws no edge through a node it does not belong to", () => {
    expect(quality(layout).throughNodes).toBe(0);
    expect(quality(layoutGraph(new LearningGraph(generate(200, false)), { showSources: false })).throughNodes).toBe(0);
  });

  it("draws every edge from the bottom of its higher end to its lower end", () => {
    for (const edge of layout.edges) {
      const [a, b] = [layout.nodes.get(edge.from)!, layout.nodes.get(edge.to)!];
      const points = polyline(edge.path);
      const start = points[0];
      const end = points[points.length - 1];
      const level = a.y + a.height / 2 - (b.y + b.height / 2);
      // Within one rank either end can come first.
      const aFirst = level < 0 || (level === 0 && Math.abs(start.x - (a.x + a.width / 2)) < 0.1);
      const [top, bottom] = aFirst ? [a, b] : [b, a];
      expect(start.x).toBeCloseTo(top.x + top.width / 2, 0);
      expect(start.y).toBeCloseTo(top.y + top.height, 0);
      expect(end.x).toBeCloseTo(bottom.x + bottom.width / 2, 0);
      // An edge between ranks ends on the top of the lower node, a soft link within one rank on its bottom.
      expect([bottom.y, bottom.y + bottom.height].some((y) => Math.abs(end.y - y) < 0.1)).toBe(true);
    }
  });

  it("keeps soft links out of the ranks", () => {
    const hard = new LearningGraph(generate(200, true).map((note) => ({ ...note, recommends: [] })));
    const withSoft = layoutGraph(big, { showSources: true });
    const without = layoutGraph(hard, { showSources: true });
    for (const [id, node] of withSoft.nodes) expect(node.y).toBe(without.nodes.get(id)!.y);
  });

  it("returns one path per ranked edge and soft link", () => {
    const { input } = prepareLayout(big, { showSources: true });
    const output = ENGINES.ts.layout(input);
    expect(output.pathStart).toHaveLength(input.from.length + input.softFrom.length + 1);
    expect(output.pathStart[output.pathStart.length - 1] * 2).toBe(output.pathPoints.length);
    for (let p = 0; p + 1 < output.pathStart.length; p++) expect((output.pathStart[p + 1] - output.pathStart[p] - 1) % 3).toBe(0);
  });
});

describe("layout of materials listed in concepts", () => {
  it("places them like material notes and draws what they teach", () => {
    const listed = { id: "material:https://example.com/a", title: "A", url: "https://example.com/a", format: "article" as const };
    const graph = new LearningGraph([
      { id: "a", title: "a", kind: "concept", requires: [], recommends: [], teaches: [], materials: [listed] },
      { id: "b", title: "b", kind: "concept", requires: [{ id: "a", title: "a" }], recommends: [], teaches: [], materials: [listed] },
    ]);
    const layout = layoutGraph(graph, { showSources: true });
    const material = layout.nodes.get(listed.id)!;
    expect(material).toBeDefined();
    expect(material.height).toBeLessThan(layout.nodes.get("a")!.height);
    const taught = layout.edges.filter((edge) => edge.from === listed.id && edge.kind === "teaches").map((edge) => edge.to);
    expect(taught.sort()).toEqual(["a", "b"]);
    expect(quality(layout).throughNodes).toBe(0);
  });
});

describe("layout of a route with skipped concepts", () => {
  const notes = generate(60, false);
  const graph = new LearningGraph(notes);
  const goal = notes[notes.length - 1].id;
  const route = (skipped: string[]) => {
    const progress = { ...emptyProgress(), goal, skipped: new Set(skipped) };
    return computeRoute(graph, progress, computeStates(graph, progress))!;
  };

  it("keeps skipped concepts on the map of the route, where the route keeps them", () => {
    const plain = route([]);
    const skipped = [...plain.closure].filter((id) => id !== goal).slice(0, 5);
    const withSkips = route(skipped);
    expect(withSkips.closure).toEqual(plain.closure);
    const layout = layoutGraph(graph, { showSources: false, only: withSkips.closure });
    for (const id of skipped) expect(layout.nodes.has(id)).toBe(true);
    // Skipping changes how nodes look, not where they stand: the same input, so the cached layout holds.
    expect(shapeKey(prepareLayout(graph, { showSources: false, only: withSkips.closure }).input)).toBe(
      shapeKey(prepareLayout(graph, { showSources: false, only: plain.closure }).input),
    );
  });
});

class FakeWorker implements LayoutWorker {
  onmessage: ((event: MessageEvent<LayoutReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: LayoutRequest[] = [];
  terminated = false;

  postMessage(request: LayoutRequest) {
    this.requests.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  answer() {
    const { id, engine, input } = this.requests[this.requests.length - 1];
    const output = ENGINES[engine].layout(input);
    this.onmessage!({ data: { id, result: { output, paths: svgPaths(output) } } } as MessageEvent<LayoutReply>);
  }

  crash() {
    this.onerror!({ message: "boom", preventDefault() {} } as ErrorEvent);
  }
}

function runnerWithWorkers() {
  const workers: FakeWorker[] = [];
  const runner = new LayoutRunner("/* worker */", "ts", () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { runner, workers };
}

const input = (graph: LearningGraph, showSources = true): EngineInput => prepareLayout(graph, { showSources }).input;

describe("layout runner", () => {
  it("lays small graphs out at once", () => {
    const { runner, workers } = runnerWithWorkers();
    const small = input(new LearningGraph(generate(20, false)), false);
    expect(small.width.length).toBeLessThan(WORKER_FROM);
    expect(runner.run(small)).not.toBeInstanceOf(Promise);
    expect(workers).toHaveLength(0);
  });

  it("sends large graphs to the worker and keeps the answer", async () => {
    const { runner, workers } = runnerWithWorkers();
    const large = input(big);
    const pending = runner.run(large);
    expect(pending).toBeInstanceOf(Promise);
    expect(runner.busy).toBe(true);
    workers[0].answer();
    const output = await pending;
    expect(output?.output.x).toHaveLength(large.width.length);
    expect(runner.busy).toBe(false);
    // The same shape again comes from the cache, at once.
    expect(runner.run(input(big))).toBe(output);
    expect(runner.stats).toMatchObject({ inWorker: 1, cached: 1 });
  });

  it("drops a request when a newer one comes, stopping the busy worker", async () => {
    const { runner, workers } = runnerWithWorkers();
    const first = runner.run(input(big));
    const second = runner.run(input(new LearningGraph(generate(300, false)), false));
    expect(await first).toBeNull();
    expect(workers[0].terminated).toBe(true);
    workers[1].answer();
    expect(await second).not.toBeNull();
    expect(runner.stats.cancelled).toBe(1);
  });

  it("falls back to this thread when the worker fails", async () => {
    const { runner, workers } = runnerWithWorkers();
    const pending = runner.run(input(big));
    workers[0].crash();
    expect((await pending)?.output.x).toHaveLength(input(big).width.length);
    // A failed worker is not tried again.
    expect(runner.run(input(new LearningGraph(generate(300, false)), false))).not.toBeInstanceOf(Promise);
    expect(workers).toHaveLength(1);
  });

  it("stays on this thread without a worker script or without workers", async () => {
    expect(new LayoutRunner().run(input(big))).not.toBeInstanceOf(Promise);
    const noWorkers = new LayoutRunner("/* worker */", "ts", () => {
      throw new ReferenceError("Worker is not defined");
    });
    // The first request finds out, already answered; the next ones do not try again.
    expect((await noWorkers.run(input(big)))?.output.x).toHaveLength(input(big).width.length);
    expect(noWorkers.run(input(new LearningGraph(generate(300, false)), false))).not.toBeInstanceOf(Promise);
  });

  it("tells shapes apart by sizes, edges and soft links", () => {
    const base = input(big);
    expect(shapeKey(base)).toBe(shapeKey(input(big)));
    expect(shapeKey({ ...base, softTo: base.softTo.map((v, i) => (i === 0 ? (v + 1) % base.width.length : v)) })).not.toBe(shapeKey(base));
    expect(shapeKey({ ...base, height: base.height.map((h, i) => (i === 0 ? h + 1 : h)) })).not.toBe(shapeKey(base));
  });
});

describe("layout after a map scope change", () => {
  const ref = (id: string, excluded?: string) => ({ id, title: id.replace(/^ghost:/, "").replace(/^.*\//, ""), excluded });
  const concept = (id: string, requires: ReturnType<typeof ref>[] = []) => ({ id, title: ref(id).title, kind: "concept" as const, requires, recommends: [], teaches: [] });
  const full = new LearningGraph([
    concept("Goal", [ref("Base"), ref("Archive/Archived")]),
    concept("Base"),
    concept("Archive/Archived", [ref("Base")]),
    concept("Archive/Extra", [ref("Base")]),
  ]);
  // Archive excluded: the linked note turns into a placeholder, the unlinked one is gone.
  const scoped = new LearningGraph([concept("Goal", [ref("Base"), ref("ghost:Archived", "Archive/Archived.md")]), concept("Base")]);

  it("gets a new shape key, so the cached layout is not reused", () => {
    expect(shapeKey(input(scoped, false))).not.toBe(shapeKey(input(full, false)));
  });

  it("places the placeholder and drops the excluded note", () => {
    const layout = layoutGraph(scoped, { showSources: false });
    expect(layout.nodes.has("ghost:Archived")).toBe(true);
    expect(layout.nodes.has("Archive/Extra")).toBe(false);
    expect(layout.nodes.has("Archive/Archived")).toBe(false);
  });
});
