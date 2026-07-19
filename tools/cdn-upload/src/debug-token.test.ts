import { describe, expect, it } from "vite-plus/test";
import { createBunnyDirectoryTokenQuery, upsertEnvValue } from "./debug-token.js";

describe("CDN debug token", () => {
  it("creates an advanced Bunny directory-token query", () => {
    const query = new URLSearchParams(
      createBunnyDirectoryTokenQuery("test-key", "/2.1.11/", 1_999_999_999),
    );
    expect(query.get("token")).toMatch(/^HS256-[A-Za-z0-9_-]{43}$/);
    expect(query.get("expires")).toBe("1999999999");
    expect(query.get("token_path")).toBe("/2.1.11/");
  });

  it("replaces only the existing token entry in an env file", () => {
    expect(
      upsertEnvValue(
        "OTHER=value\nVITE_FPSR_CDN_TOKEN_QUERY=old\n",
        "VITE_FPSR_CDN_TOKEN_QUERY",
        "new",
      ),
    ).toBe("OTHER=value\nVITE_FPSR_CDN_TOKEN_QUERY=new\n");
  });
});
