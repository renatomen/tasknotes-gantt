/**
 * Shared field-mapping reader (single source of truth for the `tngantt_` keys).
 * Covers defaults, per-view default overrides, configured-value passthrough,
 * and that reads go through the canonical prefixed keys.
 */
import { describe, expect, it } from "@jest/globals";
import {
  FIELD_MAPPING_KEYS,
  readFieldMappings,
} from "../../src/bases/fieldMappingConfig";

/** Build a `config.get`-style reader from a plain record. */
function getter(values: Record<string, unknown>): (key: string) => unknown {
  return (key) => values[key];
}

describe("readFieldMappings", () => {
  it("defaults every property to unset (empty) — no hardcoded property names", () => {
    expect(readFieldMappings(getter({}))).toEqual({
      textProperty: "",
      startProperty: "",
      endProperty: "",
      progressProperty: "",
      parentProperty: "",
      statusProperty: "",
      priorityProperty: "",
      timeEstimateProperty: "",
      calendarProperty: "",
    });
  });

  it("applies per-view default overrides when keys are unset", () => {
    const mappings = readFieldMappings(getter({}), {
      startProperty: "note.start",
      endProperty: "note.due",
    });
    expect(mappings.startProperty).toBe("note.start");
    expect(mappings.endProperty).toBe("note.due");
    // Non-overridden properties keep the empty (unset) default.
    expect(mappings.progressProperty).toBe("");
  });

  it("uses configured values over defaults and reads via the tngantt_ keys", () => {
    const mappings = readFieldMappings(
      getter({
        [FIELD_MAPPING_KEYS.text]: "file.basename",
        [FIELD_MAPPING_KEYS.start]: "note.scheduled",
        [FIELD_MAPPING_KEYS.end]: "note.due",
        [FIELD_MAPPING_KEYS.progress]: "note.pct",
        [FIELD_MAPPING_KEYS.parent]: "note.in",
        [FIELD_MAPPING_KEYS.status]: "note.status",
        [FIELD_MAPPING_KEYS.priority]: "note.priority",
      }),
      // Overrides must NOT win when a value is actually configured.
      { startProperty: "note.start" },
    );
    expect(mappings).toEqual({
      textProperty: "file.basename",
      startProperty: "note.scheduled",
      endProperty: "note.due",
      progressProperty: "note.pct",
      parentProperty: "note.in",
      statusProperty: "note.status",
      priorityProperty: "note.priority",
      timeEstimateProperty: "",
      calendarProperty: "",
    });
  });

  it("exposes canonical keys that are all tngantt_-prefixed", () => {
    for (const key of Object.values(FIELD_MAPPING_KEYS)) {
      expect(key.startsWith("tngantt_")).toBe(true);
    }
  });
});
