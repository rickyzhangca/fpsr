/**
 * Abort helpers shared by asset sources and the renderer atlas cache.
 *
 * Semantics: aborting rejects only the waiting caller. Shared underlying work
 * continues for other concurrent consumers and is never cancelled by a waiter.
 */

export function abortError(message = "Operation aborted"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal, message?: string): void {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  throw abortError(message);
}

/**
 * Race a shared promise against an AbortSignal without cancelling the shared work.
 */
export function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
