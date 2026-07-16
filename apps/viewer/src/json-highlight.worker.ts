import { tokenizeJson } from "./highlight-json";
import type {
  JsonHighlightWorkerRequest,
  JsonHighlightWorkerResponse,
} from "./json-highlight-protocol";

const workerScope = self as unknown as {
  postMessage(message: JsonHighlightWorkerResponse): void;
  onmessage: ((event: MessageEvent<JsonHighlightWorkerRequest>) => void) | null;
};

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type !== "highlight") return;

  void (async () => {
    try {
      const lines = await tokenizeJson(request.code);
      workerScope.postMessage({
        type: "highlighted",
        requestId: request.requestId,
        lines,
      });
    } catch (error) {
      workerScope.postMessage({
        type: "error",
        requestId: request.requestId,
        message: error instanceof Error ? error.message : "JSON highlighting failed",
      });
    }
  })();
};
