import type { Blueprint, DecodeStats } from "fpsr";
import { describe, expect, it } from "vite-plus/test";
import { getAdapterChecks } from "./adapter-checks";
import { createPipelineReceipt } from "./pipeline-receipt";
import type { PlanDiagnostics } from "./plan-diagnostics";

const blueprint: Blueprint = {
  item: "blueprint",
  version: 2 * 2 ** 48,
  entities: [
    {
      entity_number: 1,
      name: "transport-belt",
      position: { x: 0.5, y: 0.5 },
    },
  ],
};

const decodeStats: DecodeStats = {
  mode: "compressed",
  inputChars: 100,
  compressedBytes: 75,
  inflatedBytes: 400,
  jsonChars: 400,
  compressionRatio: 400 / 75,
  timings: {
    totalMs: 1,
    base64Ms: 0.1,
    inflateMs: 0.2,
    utf8Ms: 0.1,
    jsonParseMs: 0.5,
    validateMs: 0.1,
  },
};

const diagnostics: PlanDiagnostics = {
  entities: { total: 1, resolved: 1, unsupported: [] },
  tiles: { total: 0, resolved: 0, unsupported: [] },
  drawList: {
    commandCount: 4,
    byKind: { sprite: 4 },
    uniqueFrames: 2,
    uniqueLayers: 2,
    atlasIndices: [0],
  },
  checks: {
    finiteBounds: true,
    finiteCommands: true,
    sortedCommands: true,
    validFrameReferences: true,
  },
};

describe("createPipelineReceipt", () => {
  it("builds a render-ready receipt from real decode and plan evidence", () => {
    const receipt = createPipelineReceipt({
      blueprint,
      blueprintPath: null,
      decodeStats,
      adapterChecks: getAdapterChecks(blueprint),
      diagnostics,
      planLoading: false,
      planError: null,
      perfReport: null,
      renderProgress: null,
      renderError: null,
    });

    expect(receipt.summary).toMatchObject({ title: "Render ready", status: "passed" });
    expect(receipt.stages.map((stage) => stage.id)).toEqual([
      "source",
      "selection",
      "compatibility",
      "resolve",
      "plan",
      "assets",
      "paint",
    ]);
    expect(receipt.verifications.every((stage) => stage.status === "passed")).toBe(true);
    expect(receipt.compatibility.every((stage) => stage.status === "not-needed")).toBe(true);
  });

  it("promotes unsupported content into visible warnings", () => {
    const receipt = createPipelineReceipt({
      blueprint,
      blueprintPath: [2, 0],
      decodeStats,
      adapterChecks: getAdapterChecks(blueprint),
      diagnostics: {
        ...diagnostics,
        entities: {
          total: 1,
          resolved: 0,
          unsupported: [{ name: "modded-chest", count: 1, entityNumbers: [1] }],
        },
      },
      planLoading: false,
      planError: null,
      perfReport: null,
      renderProgress: null,
      renderError: null,
    });

    expect(receipt.summary).toMatchObject({
      title: "Render ready with warnings",
      status: "warning",
    });
    expect(receipt.findings[0]).toMatchObject({ title: "Unsupported entity: modded-chest" });
    expect(receipt.tags).toContain("Modded content");
  });

  it("shows the actual render progress state", () => {
    const receipt = createPipelineReceipt({
      blueprint,
      blueprintPath: null,
      decodeStats,
      adapterChecks: getAdapterChecks(blueprint),
      diagnostics,
      planLoading: false,
      planError: null,
      perfReport: null,
      renderProgress: { value: 65, label: "Loading assets 3/5" },
      renderError: null,
    });

    expect(receipt.summary).toMatchObject({
      title: "Loading assets 3/5",
      status: "running",
      progress: 65,
    });
  });

  it("reports compatibility conversions as passed with conversion details", () => {
    const legacyBlueprint: Blueprint = {
      ...blueprint,
      version: 1 * 2 ** 48,
      entities: [{ ...blueprint.entities![0]!, direction: 2 }],
    };
    const receipt = createPipelineReceipt({
      blueprint: legacyBlueprint,
      blueprintPath: null,
      decodeStats,
      adapterChecks: getAdapterChecks(legacyBlueprint),
      diagnostics,
      planLoading: false,
      planError: null,
      perfReport: null,
      renderProgress: null,
      renderError: null,
    });

    expect(receipt.stages.find((stage) => stage.id === "compatibility")).toMatchObject({
      status: "passed",
      value: "1 entity converted",
    });
    expect(
      receipt.compatibility.find((stage) => stage.id === "scale-legacy-directions"),
    ).toMatchObject({ status: "passed", value: "1 applied" });
  });
});
