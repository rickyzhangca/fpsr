/**
 * Factorio 2.x `defines.wire_connector_id` numeric values used in blueprint
 * `wires` tuples: [src_entity, src_connector, dst_entity, dst_connector].
 *
 * Confirmed against runtime docs / wiki talk / draftsman (values are not unique
 * across names — circuit_red and combinator_input_red both equal 1).
 */
export const WIRE_CONNECTOR_ID = {
  circuit_red: 1,
  circuit_green: 2,
  combinator_input_red: 1,
  combinator_input_green: 2,
  combinator_output_red: 3,
  combinator_output_green: 4,
  pole_copper: 5,
  power_switch_left_copper: 5,
  power_switch_right_copper: 6,
} as const;

export type WireColor = "copper" | "red" | "green";

/**
 * Map a blueprint wire_connector_id to the drawn wire color.
 * Combinator output connectors use the same color as the matching input.
 */
export function wireConnectorColor(connectorId: number): WireColor | undefined {
  switch (connectorId) {
    case WIRE_CONNECTOR_ID.circuit_red:
    case WIRE_CONNECTOR_ID.combinator_output_red:
      return "red";
    case WIRE_CONNECTOR_ID.circuit_green:
    case WIRE_CONNECTOR_ID.combinator_output_green:
      return "green";
    case WIRE_CONNECTOR_ID.pole_copper:
    case WIRE_CONNECTOR_ID.power_switch_right_copper:
      return "copper";
    default:
      return undefined;
  }
}
