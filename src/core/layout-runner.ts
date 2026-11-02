import { svgPaths, type EngineResult } from "./layout";
import { DEFAULT_ENGINE, ENGINES, type EngineInput } from "./layout-engine";

/** Below this many nodes the layout takes a few milliseconds, less than a trip to the worker. */
export const WORKER_FROM = 150;
const CACHE_SIZE = 6;

export interface LayoutRequest {
  id: number;
  /** Key of `ENGINES`. */
  engine: string;
  input: EngineInput;
}

export interface LayoutReply {
  id: number;
  /** The engine that did the work: the one asked for, or `ts` when it could not run. */
  engine?: string;
  result?: EngineResult;
  error?: string;
}

/** The part of `Worker` the runner needs, so tests can stand in for it. */
export interface LayoutWorker {
  onmessage: ((event: MessageEvent<LayoutReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(request: LayoutRequest): void;
  terminate(): void;
}

interface Job {
  id: number;
  key: string;
  input: EngineInput;
  resolve: (result: EngineResult | null) => void;
}

/**
 * Runs the layout off the main thread for large graphs, so the map stays responsive while it
 * works. A newer request cancels the one in flight; recent results are kept by the shape of the
 * graph, so switching between the route and the whole map does not lay it out again. Without
 * workers (or when one fails) the layout runs on the calling thread.
 */
export class LayoutRunner {
  private worker: LayoutWorker | null = null;
  private url: string | null = null;
  private broken: boolean;
  private job: Job | null = null;
  private nextId = 1;
  private readonly cache = new Map<string, EngineResult>();
  readonly stats = { computed: 0, cached: 0, inWorker: 0, cancelled: 0, engine: "" };

  /**
   * @param source The worker script, bundled from `layout-worker.ts`.
   * @param engine Key of `ENGINES`, run in the worker and, when there is none, on this thread.
   * @param spawn Creates the worker; tests pass their own.
   */
  constructor(
    private readonly source?: string,
    private readonly engine = DEFAULT_ENGINE,
    private readonly spawn: (url: string) => LayoutWorker = (url) => new Worker(url),
  ) {
    // Where there are no workers, `spawn` throws and the runner stays on this thread.
    this.broken = !source;
  }

  /** The result at once when it is cached or cheap, otherwise a promise; `null` means a newer request took over. */
  run(input: EngineInput): EngineResult | Promise<EngineResult | null> {
    const key = shapeKey(input);
    const cached = this.cache.get(key);
    if (cached) {
      this.cancel();
      this.stats.cached++;
      this.remember(key, cached);
      return cached;
    }
    if (this.broken || input.width.length < WORKER_FROM) {
      this.cancel();
      return this.compute(key, input);
    }
    return new Promise((resolve) => {
      this.cancel();
      this.start({ id: this.nextId++, key, input, resolve });
    });
  }

  /** Whether a request is waiting for the worker. */
  get busy() {
    return this.job !== null;
  }

  dispose() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  private compute(key: string, input: EngineInput) {
    const engine = ENGINES[this.engine] ?? ENGINES.ts;
    const output = engine.layout(input);
    const result = { output, paths: svgPaths(output) };
    this.stats.computed++;
    this.used(engine.id, "on the main thread");
    this.remember(key, result);
    return result;
  }

  private start(job: Job) {
    const worker = this.ensureWorker();
    if (!worker) {
      job.resolve(this.compute(job.key, job.input));
      return;
    }
    this.job = job;
    worker.postMessage({ id: job.id, engine: this.engine, input: job.input });
  }

  /** Drops the request in flight. A worker that is still busy with it is stopped, not waited for. */
  private cancel() {
    const job = this.job;
    if (!job) return;
    this.job = null;
    this.stats.cancelled++;
    this.worker?.terminate();
    this.worker = null;
    job.resolve(null);
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    try {
      this.url ??= URL.createObjectURL(new Blob([this.source!], { type: "text/javascript" }));
      const worker = this.spawn(this.url);
      worker.onmessage = (event) => this.onReply(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        this.fail(event.message);
      };
      this.worker = worker;
      return worker;
    } catch (error) {
      this.broken = true;
      console.error("Tropa: layout worker unavailable, laying out on the main thread", error);
      return null;
    }
  }

  private onReply(reply: LayoutReply) {
    const job = this.job;
    if (!job || reply.id !== job.id) return;
    if (!reply.result) {
      this.fail(reply.error ?? "no result");
      return;
    }
    this.job = null;
    this.stats.inWorker++;
    this.used(reply.engine ?? this.engine, "in a worker");
    this.remember(job.key, reply.result);
    job.resolve(reply.result);
  }

  /** A worker that fails once is not trusted again: this request and the next ones run here. */
  private fail(reason: string) {
    console.error("Tropa: layout worker failed, laying out on the main thread", reason);
    this.broken = true;
    this.worker?.terminate();
    this.worker = null;
    const job = this.job;
    this.job = null;
    if (job) job.resolve(this.compute(job.key, job.input));
  }

  /** Says once which engine lays the map out, and again whenever that changes. */
  private used(engine: string, where: string) {
    const said = `${engine} ${where}`;
    if (said !== this.stats.engine) console.debug(`Tropa: map layout by ${engine} ${where}`);
    this.stats.engine = said;
  }

  private remember(key: string, result: EngineResult) {
    this.cache.delete(key);
    this.cache.set(key, result);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
  }
}

/** Identifies the shape of a layout input: sizes, edges and ranking mode. */
export function shapeKey(input: EngineInput) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const mix = (value: number) => {
    h1 = Math.imul(h1 ^ value, 2654435761);
    h2 = Math.imul(h2 ^ value, 1597334677);
  };
  for (let i = 0; i < input.width.length; i++) {
    mix(Math.round(input.width[i] * 8));
    mix(Math.round(input.height[i] * 8));
  }
  for (let e = 0; e < input.from.length; e++) {
    mix(input.from[e]);
    mix(input.to[e]);
    mix(input.weight[e]);
  }
  for (let s = 0; s < input.softFrom.length; s++) {
    mix(input.softFrom[s]);
    mix(input.softTo[s]);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${input.width.length}:${input.from.length}:${input.softFrom.length}:${input.tight ? 1 : 0}:${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}
