import { describe, expect, it } from "vite-plus/test";
import { WIRE_CONNECTOR_ID, wireConnectorColor } from "../src/wire-connectors.js";

describe("wireConnectorColor", () => {
  it("maps defines.wire_connector_id values to copper/red/green", () => {
    expect(wireConnectorColor(WIRE_CONNECTOR_ID.circuit_red)).toBe("red");
    expect(wireConnectorColor(WIRE_CONNECTOR_ID.circuit_green)).toBe("green");
    expect(wireConnectorColor(WIRE_CONNECTOR_ID.combinator_input_red)).toBe("red");
    expect(wireConnectorColor(WIRE_CONNECTOR_ID.combinator_input_green)).toBe("green");
    expect(wireConnectorColor(WIRE_CONNECTOR_ID.combinator_output_red)).toBe("red");
    expect(wireConnectorColor(WIRE_CONNECTOR_ID.combinator_output_green)).toBe("green");
    expect(wireConnectorColor(WIRE_CONNECTOR_ID.pole_copper)).toBe("copper");
    expect(wireConnectorColor(WIRE_CONNECTOR_ID.power_switch_left_copper)).toBe("copper");
    expect(wireConnectorColor(WIRE_CONNECTOR_ID.power_switch_right_copper)).toBe("copper");
  });

  it("uses the documented numeric table", () => {
    expect(WIRE_CONNECTOR_ID.circuit_red).toBe(1);
    expect(WIRE_CONNECTOR_ID.circuit_green).toBe(2);
    expect(WIRE_CONNECTOR_ID.combinator_output_red).toBe(3);
    expect(WIRE_CONNECTOR_ID.combinator_output_green).toBe(4);
    expect(WIRE_CONNECTOR_ID.pole_copper).toBe(5);
    expect(WIRE_CONNECTOR_ID.power_switch_right_copper).toBe(6);
  });

  it("returns undefined for unknown connector ids", () => {
    expect(wireConnectorColor(0)).toBeUndefined();
    expect(wireConnectorColor(99)).toBeUndefined();
  });
});
