import { describe, expect, it } from "vite-plus/test";
import {
  computeFluidConnections,
  distillFluidRecipes,
  fluidWorkingVisualisationGroupsFromBoxes,
} from "../src/distill/shared/pipe.js";

describe("fluid recipe / connection roles distill", () => {
  it("distillFluidRecipes flags ingredient vs product fluids", () => {
    const out = distillFluidRecipes({
      "iron-gear-wheel": {
        ingredients: [{ type: "item", name: "iron-plate", amount: 2 }],
        results: [{ type: "item", name: "iron-gear-wheel", amount: 1 }],
      },
      concrete: {
        ingredients: [
          { type: "item", name: "stone-brick", amount: 5 },
          { type: "fluid", name: "water", amount: 100 },
        ],
        results: [{ type: "item", name: "concrete", amount: 10 }],
      },
      "sulfuric-acid": {
        ingredients: [
          { type: "item", name: "sulfur", amount: 5 },
          { type: "fluid", name: "water", amount: 100 },
        ],
        results: [{ type: "fluid", name: "sulfuric-acid", amount: 50 }],
      },
      "ice-melting": {
        ingredients: [{ type: "item", name: "ice", amount: 1 }],
        results: [{ type: "fluid", name: "water", amount: 20 }],
      },
    });
    expect(out["iron-gear-wheel"]).toBeUndefined();
    expect(out.concrete).toEqual({ ingredients: true, products: false });
    expect(out["sulfuric-acid"]).toEqual({ ingredients: true, products: true });
    expect(out["ice-melting"]).toEqual({ ingredients: false, products: true });
  });

  it("computeFluidConnections tags input/output roles from production_type", () => {
    const { connections, roles, flows, facings, hideInfo } = computeFluidConnections({
      fluid_boxes: [
        {
          production_type: "input",
          pipe_connections: [{ position: [0, -1], direction: 0, flow_direction: "input" }],
        },
        {
          production_type: "output",
          pipe_connections: [{ position: [0, 1], direction: 8, flow_direction: "output" }],
        },
      ],
    });
    expect(connections["0"]).toEqual([
      [0, -2],
      [0, 2],
    ]);
    expect(roles["0"]).toEqual(["input", "output"]);
    expect(flows["0"]).toEqual(["input", "output"]);
    expect(facings["0"]).toEqual([0, 8]);
    expect(hideInfo["0"]).toEqual([false, false]);
  });

  it("computeFluidConnections records flow_direction, facing, and hide_connection_info", () => {
    const { connections, roles, flows, facings, hideInfo } = computeFluidConnections({
      fluid_box: {
        production_type: "input",
        pipe_connections: [
          {
            position: [0, -0.5],
            direction: 0,
            flow_direction: "output",
          },
          {
            position: [0, 0.5],
            direction: 8,
            flow_direction: "input",
            hide_connection_info: true,
          },
        ],
      },
    });
    expect(connections["0"]).toEqual([
      [0, -1.5],
      [0, 1.5],
    ]);
    // Box production_type is input for both; flow differs per connection.
    expect(roles["0"]).toEqual(["input", "input"]);
    expect(flows["0"]).toEqual(["output", "input"]);
    expect(facings["0"]).toEqual([0, 8]);
    expect(hideInfo["0"]).toEqual([false, true]);
  });

  it("computeFluidConnections defaults omitted flow_direction to input-output", () => {
    const { flows } = computeFluidConnections({
      fluid_box: {
        pipe_connections: [
          { position: [-1, 0.5], direction: 12 },
          { position: [1, 0.5], direction: 4, flow_direction: "input-output" },
        ],
      },
    });
    expect(flows["0"]).toEqual(["input-output", "input-output"]);
  });

  it("fluidWorkingVisualisationGroupsFromBoxes maps enable_working_visualisations to roles", () => {
    const groups = fluidWorkingVisualisationGroupsFromBoxes(
      {
        fluid_boxes: [
          {
            production_type: "input",
            enable_working_visualisations: ["input-pipe"],
            pipe_connections: [{ position: [-1, 2], direction: 8 }],
          },
          {
            production_type: "input",
            enable_working_visualisations: ["input-pipe"],
            pipe_connections: [{ position: [1, 2], direction: 8 }],
          },
          {
            production_type: "output",
            enable_working_visualisations: ["output-pipe"],
            pipe_connections: [{ position: [-1, -2], direction: 0 }],
          },
          {
            production_type: "output",
            enable_working_visualisations: ["output-pipe"],
            pipe_connections: [{ position: [1, -2], direction: 0 }],
          },
        ],
      },
      { "output-pipe": [3], "input-pipe": [4] },
    );
    expect(groups).toEqual({ input: [4], output: [3] });
    expect(
      fluidWorkingVisualisationGroupsFromBoxes(
        { fluid_boxes: [{ production_type: "input", pipe_connections: [] }] },
        { "input-pipe": [4] },
      ),
    ).toBeUndefined();
  });
});
