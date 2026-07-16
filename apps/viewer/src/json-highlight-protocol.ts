export interface JsonHighlightToken {
  content: string;
  color?: string;
}
export type JsonHighlightWorkerRequest = {
  type: "highlight";
  requestId: number;
  code: string;
};
export type JsonHighlightWorkerResponse =
  | {
      type: "highlighted";
      requestId: number;
      lines: JsonHighlightToken[][];
    }
  | {
      type: "error";
      requestId: number;
      message: string;
    };
