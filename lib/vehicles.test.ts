import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_VEHICLE_LABEL, isUuid, preferredVehicleTypeKey, vehicleLabel } from "./vehicles.ts";

const hondaId = "9b7ea010-fafd-4032-8e15-6583f2d50043";
const types = [
  { id: hondaId, label: "Honda" },
  { id: "volkswagen", label: "Volkswagen" },
];

test("vehicleLabel maps deal_type_id UUIDs to the human-readable type name", () => {
  assert.equal(vehicleLabel(types, hondaId), "Honda");
  assert.equal(vehicleLabel(types, hondaId, "Honda"), "Honda");
  assert.equal(vehicleLabel(types, "volkswagen"), "Volkswagen");
  assert.equal(vehicleLabel([], "Honda"), "Honda");
  assert.equal(vehicleLabel([], "used"), "Used");
});

test("vehicleLabel falls back to Standard for unknown UUIDs and keeps plain text", () => {
  assert.equal(isUuid(hondaId), true);
  assert.equal(isUuid("Honda"), false);
  assert.equal(vehicleLabel([], hondaId), FALLBACK_VEHICLE_LABEL);
  assert.equal(vehicleLabel(types, "11111111-1111-4111-8111-111111111111"), FALLBACK_VEHICLE_LABEL);
  assert.equal(vehicleLabel([], "", "Used"), "Used");
});

test("preferredVehicleTypeKey prefers a human-readable deal_type_name over a UUID id", () => {
  assert.equal(preferredVehicleTypeKey(hondaId, "Honda"), "Honda");
  assert.equal(preferredVehicleTypeKey(hondaId, hondaId), hondaId);
  assert.equal(preferredVehicleTypeKey("", "Used"), "Used");
  assert.equal(preferredVehicleTypeKey("volkswagen", ""), "volkswagen");
});
