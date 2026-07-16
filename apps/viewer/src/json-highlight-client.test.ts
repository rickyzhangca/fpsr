import { describe, expect, it } from "vite-plus/test";
import { JsonHighlightWorkerClient } from "./json-highlight-client";
import type {
  JsonHighlightWorkerRequest,
  JsonHighlightWorkerResponse,
} from "./json-highlight-protocol";

class FakeWorker extends EventTarget {
  readonly posts: JsonHighlightWorkerRequest[] = [];

  postMessage(message: JsonHighlightWorkerRequest): void {
    this.posts.push(message);
  }

  respond(message: JsonHighlightWorkerResponse): void {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
}

describe("JsonHighlightWorkerClient", () => {
  it("resolves token pages returned by the worker", async () => {
    const worker = new FakeWorker();
    const client = new JsonHighlightWorkerClient(worker as unknown as Worker);
    const pending = client.highlight('{"value":1}');
    const request = worker.posts[0];
    if (!request) throw new Error("expected highlight request");

    worker.respond({
      type: "highlighted",
      requestId: request.requestId,
      lines: [[{ content: "{", color: "#fff" }]],
    });

    await expect(pending).resolves.toEqual([[{ content: "{", color: "#fff" }]]);
  });

  it("rejects page-level highlighting errors", async () => {
    const worker = new FakeWorker();
    const client = new JsonHighlightWorkerClient(worker as unknown as Worker);
    const pending = client.highlight("{");
    const request = worker.posts[0];
    if (!request) throw new Error("expected highlight request");

    worker.respond({ type: "error", requestId: request.requestId, message: "bad JSON" });
    await expect(pending).rejects.toThrow("bad JSON");
  });
});
