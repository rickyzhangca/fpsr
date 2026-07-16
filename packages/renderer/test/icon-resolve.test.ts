import { describe, expect, it } from "vite-plus/test";
import { resolveIconFrameId } from "../src/icon-resolve.js";
import { makeMiniDb } from "./fixtures/mini-db.js";

describe("resolveIconFrameId", () => {
  const db = makeMiniDb();

  it("resolves a direct item icon key", () => {
    expect(resolveIconFrameId(db, "item/iron-plate")).toBe(3);
  });

  it("falls back to the placing item for tile prototype names", () => {
    expect(resolveIconFrameId(db, "item/stone-path")).toBe(3);
    expect(db.icons["item/stone-path"]).toBeUndefined();
    expect(db.tiles["stone-path"]?.item).toBe("stone-brick");
  });

  it("returns undefined when no icon or tile mapping exists", () => {
    expect(resolveIconFrameId(db, "item/missing-tile")).toBeUndefined();
    expect(resolveIconFrameId(db, "entity/stone-path")).toBeUndefined();
  });
});
