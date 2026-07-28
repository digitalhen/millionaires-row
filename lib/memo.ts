/**
 * Process-lifetime memoisation for derived figures.
 *
 * The roll is loaded once by the pipeline and never written to while the app is
 * running — a deploy is the only thing that changes it, and a deploy is a new
 * process. So anything computed from it can be held for the life of the
 * process, which is what turns repeated full-table aggregates into a map read.
 *
 * The *promise* is stored, not the value: N concurrent first requests share one
 * round trip instead of racing, and a rejected promise is evicted so a
 * transient database error is not cached forever.
 *
 * Keys are bounded by the data, not by user input: one leaderboard, one stats
 * blob, five boroughs, ~240 ZIPs. Nothing keyed on a search term or a parcel id
 * belongs here.
 */
const memo = new Map<string, Promise<unknown>>();

export function memoize<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = memo.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const pending = run().catch((err) => {
    memo.delete(key);
    throw err;
  });
  memo.set(key, pending);
  return pending;
}

/** Test seam / after a data reload in a long-lived process. */
export function resetMemo(): void {
  memo.clear();
}
