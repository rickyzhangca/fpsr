import type {
  JsonHighlightToken,
  JsonHighlightWorkerRequest,
  JsonHighlightWorkerResponse,
} from "./jsonHighlightProtocol";

export class JsonHighlightWorkerClient {
  private readonly pending = new Map<
    number,
    { resolve(lines: JsonHighlightToken[][]): void; reject(error: Error): void }
  >();
  private nextRequestId = 1;
  private failure?: Error;

  constructor(private readonly worker: Worker) {
    worker.addEventListener("message", (event: MessageEvent<JsonHighlightWorkerResponse>) => {
      this.handleMessage(event.data);
    });
    worker.addEventListener("error", (event) => {
      this.fail(new Error(event.message || "JSON highlight worker failed"));
    });
  }

  highlight(code: string): Promise<JsonHighlightToken[][]> {
    if (this.failure) return Promise.reject(this.failure);

    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const request: JsonHighlightWorkerRequest = { type: "highlight", requestId, code };
      this.worker.postMessage(request);
    });
  }

  private handleMessage(response: JsonHighlightWorkerResponse): void {
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);

    if (response.type === "error") {
      pending.reject(new Error(response.message));
    } else {
      pending.resolve(response.lines);
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) pending.reject(this.failure);
    this.pending.clear();
  }
}

let workerClient: JsonHighlightWorkerClient | undefined;

function getWorkerClient(): JsonHighlightWorkerClient {
  if (!workerClient) {
    const worker = new Worker(new URL("./jsonHighlight.worker.ts", import.meta.url), {
      type: "module",
    });
    workerClient = new JsonHighlightWorkerClient(worker);
  }
  return workerClient;
}

export function highlightJsonPage(code: string): Promise<JsonHighlightToken[][]> {
  if (typeof Worker === "undefined") {
    return Promise.reject(new Error("JSON highlighting requires Web Worker support"));
  }
  return getWorkerClient().highlight(code);
}
