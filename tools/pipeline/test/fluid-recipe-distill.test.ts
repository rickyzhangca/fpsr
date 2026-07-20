import { describe, expect, it } from "vite-plus/test";
import { computeFluidConnections, distillFluidRecipes } from "../src/distill/shared/pipe.js";

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
    const { connections, roles } = computeFluidConnections({
      fluid_boxes: [
        {
          production_type: "input",
          pipe_connections: [{ position: [0, -1], direction: 0 }],
        },
        {
          production_type: "output",
          pipe_connections: [{ position: [0, 1], direction: 8 }],
        },
      ],
    });
    expect(connections["0"]).toEqual([
      [0, -2],
      [0, 2],
    ]);
    expect(roles["0"]).toEqual(["input", "output"]);
  });
});
