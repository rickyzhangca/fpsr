/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  cornerRadiiToCss,
  effectiveClipCornerRadii,
  findRoundedClipAncestor,
  parseCssRadiusPx,
} from "./clip-corner-radii";

describe("parseCssRadiusPx", () => {
  it("parses px radii and ignores elliptical second axis", () => {
    expect(parseCssRadiusPx("14px")).toBe(14);
    expect(parseCssRadiusPx("12px 8px")).toBe(12);
    expect(parseCssRadiusPx("0px")).toBe(0);
    expect(parseCssRadiusPx("50%")).toBe(0);
  });
});

describe("cornerRadiiToCss", () => {
  it("formats CSS border-radius shorthand", () => {
    expect(cornerRadiiToCss({ tl: 1, tr: 2, br: 3, bl: 4 })).toBe("1px 2px 3px 4px");
  });
});

describe("effectiveClipCornerRadii", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("returns zero radii without a rounded clip ancestor", () => {
    const el = document.createElement("div");
    document.body.append(el);
    expect(findRoundedClipAncestor(el)).toBeNull();
    expect(effectiveClipCornerRadii(el)).toEqual({ tl: 0, tr: 0, br: 0, bl: 0 });
  });

  it("matches flush bottom corners to a rounded clipping ancestor", () => {
    const clip = document.createElement("div");
    const child = document.createElement("div");
    clip.append(child);
    document.body.append(clip);

    vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
      if (el === clip) {
        return {
          overflow: "hidden",
          overflowX: "hidden",
          overflowY: "hidden",
          borderTopLeftRadius: "14px",
          borderTopRightRadius: "14px",
          borderBottomRightRadius: "14px",
          borderBottomLeftRadius: "14px",
        } as CSSStyleDeclaration;
      }
      return {
        overflow: "visible",
        overflowX: "visible",
        overflowY: "visible",
        borderTopLeftRadius: "0px",
        borderTopRightRadius: "0px",
        borderBottomRightRadius: "0px",
        borderBottomLeftRadius: "0px",
      } as CSSStyleDeclaration;
    });

    clip.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 300,
        width: 400,
        height: 300,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;
    child.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 100,
        right: 400,
        bottom: 300,
        width: 400,
        height: 200,
        x: 0,
        y: 100,
        toJSON() {},
      }) as DOMRect;

    expect(findRoundedClipAncestor(child)).toBe(clip);
    expect(effectiveClipCornerRadii(child)).toEqual({
      tl: 0,
      tr: 0,
      br: 14,
      bl: 14,
    });
  });

  it("shrinks radii by inset from the clipping ancestor", () => {
    const clip = document.createElement("div");
    const child = document.createElement("div");
    clip.append(child);
    document.body.append(clip);

    vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
      if (el === clip) {
        return {
          overflow: "hidden",
          overflowX: "hidden",
          overflowY: "hidden",
          borderTopLeftRadius: "14px",
          borderTopRightRadius: "14px",
          borderBottomRightRadius: "14px",
          borderBottomLeftRadius: "14px",
        } as CSSStyleDeclaration;
      }
      return {
        overflow: "visible",
        overflowX: "visible",
        overflowY: "visible",
        borderTopLeftRadius: "0px",
        borderTopRightRadius: "0px",
        borderBottomRightRadius: "0px",
        borderBottomLeftRadius: "0px",
      } as CSSStyleDeclaration;
    });

    clip.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 300,
        width: 400,
        height: 300,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;
    child.getBoundingClientRect = () =>
      ({
        left: 1,
        top: 1,
        right: 399,
        bottom: 299,
        width: 398,
        height: 298,
        x: 1,
        y: 1,
        toJSON() {},
      }) as DOMRect;

    expect(effectiveClipCornerRadii(child)).toEqual({
      tl: 13,
      tr: 13,
      br: 13,
      bl: 13,
    });
  });
});
