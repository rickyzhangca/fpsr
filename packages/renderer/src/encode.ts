import { zlibSync } from "fflate";
import { base64Encode, utf8Encode } from "./base64.js";
import type { BlueprintDocument } from "./types/blueprint.js";

/**
 * Encode a BlueprintDocument into a Factorio blueprint string (version byte 0).
 */
export function encode(doc: BlueprintDocument): string {
  const json = JSON.stringify(doc);
  const bytes = utf8Encode(json);
  const deflated = zlibSync(bytes, { level: 9 });
  const b64 = base64Encode(deflated);
  return `0${b64}`;
}
