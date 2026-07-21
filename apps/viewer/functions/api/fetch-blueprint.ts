import { handleFetchBlueprintRequest } from "../../src/shell/source-proxy";

type PagesFunction = (context: { request: Request }) => Response | Promise<Response>;

export const onRequestGet: PagesFunction = async (context) => {
  return handleFetchBlueprintRequest(context.request.url);
};
