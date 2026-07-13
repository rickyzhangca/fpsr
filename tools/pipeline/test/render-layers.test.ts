import { describe, expect, it } from "vite-plus/test";
import {
  officialLayer,
  railPieceLayerFromDump,
  guessedLayer,
  fpsrLayer,
  OFFICIAL_RENDER_LAYER_NAMES,
} from "../src/render-layers.js";

describe("officialLayer", () => {
  it("accepts Factorio RenderLayer names", () => {
    expect(officialLayer("object")).toBe("object");
    expect(officialLayer("floor-mechanics")).toBe("floor-mechanics");
    expect(officialLayer("rail-tie")).toBe("rail-tie");
  });

  it("rejects fpsr-only and unknown strings", () => {
    expect(officialLayer("shadow")).toBeNull();
    expect(officialLayer("ground-tile")).toBeNull();
    expect(officialLayer("rail-ties")).toBeNull();
    expect(officialLayer("nope")).toBeNull();
    expect(officialLayer(undefined)).toBeNull();
  });

  it("covers the full official enum size", () => {
    expect(OFFICIAL_RENDER_LAYER_NAMES.size).toBe(71);
  });
});

describe("railPieceLayerFromDump", () => {
  const pictures = {
    render_layers: {
      stone_path_lower: "rail-stone-path-lower",
      stone_path: "rail-stone-path",
      tie: "rail-tie",
      screw: "rail-screw",
      metal: "rail-metal",
    },
  };

  it("reads OFFICIAL layers from dump render_layers", () => {
    expect(railPieceLayerFromDump(pictures, "stone_path", false)).toEqual({
      layer: "rail-stone-path",
      source: "official",
    });
    expect(railPieceLayerFromDump(pictures, "ties", false)).toEqual({
      layer: "rail-tie",
      source: "official",
    });
    expect(railPieceLayerFromDump(pictures, "backplates", false)).toEqual({
      layer: "rail-screw",
      source: "official",
    });
    expect(railPieceLayerFromDump(pictures, "metals", false)).toEqual({
      layer: "rail-metal",
      source: "official",
    });
    expect(railPieceLayerFromDump(pictures, "stone_path_background", false)).toEqual({
      layer: "rail-stone-path-lower",
      source: "official",
    });
  });

  it("falls back to GUESS when dump map is missing", () => {
    const r = railPieceLayerFromDump({}, "ties", false);
    expect(r.source).toBe("guess");
    expect(r.layer).toBe("rail-tie");
  });
});

describe("guessedLayer / fpsrLayer", () => {
  it("pass through for call-site marking", () => {
    expect(guessedLayer("object", "reason")).toBe("object");
    expect(fpsrLayer("shadow", "reason")).toBe("shadow");
  });
});
