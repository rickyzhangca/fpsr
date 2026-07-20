import os from "node:os";

/** Run async work over items with a concurrency limit; results keep input order. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const limit = Math.max(1, Math.min(concurrency, Math.max(1, items.length)));

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/** Log wall-clock seconds for a named pipeline stage. */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const seconds = (performance.now() - start) / 1000;
    console.log(`timing: ${label} ${seconds.toFixed(1)}s`);
  }
}

export function defaultConcurrency(cap = 8): number {
  const cpus = os.availableParallelism?.() ?? Math.max(1, os.cpus().length);
  return Math.max(1, Math.min(cap, cpus));
}
