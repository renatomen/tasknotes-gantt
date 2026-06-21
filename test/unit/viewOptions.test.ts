/**
 * Locks down the Bases view-options builders extracted from register.ts.
 * Asserts the option SHAPES — in particular the number→slider and
 * boolean→toggle remaps (the official Bases options union forbids 'number'
 * and 'boolean' controls), plus the shared field-mapping property options.
 */
import { describe, expect, it } from "@jest/globals";
import type { BasesAllOptions } from "obsidian";
import {
  ganttViewOptions,
  taskListViewOptions,
} from "../../src/bases/viewOptions";
import { FIELD_MAPPING_KEYS } from "../../src/bases/fieldMappingConfig";

/** Find a single option by its `key` within an option array. */
function byKey(options: BasesAllOptions[], key: string): BasesAllOptions {
  const match = options.filter((o) => "key" in o && o.key === key);
  expect(match).toHaveLength(1);
  return match[0];
}

describe("ganttViewOptions", () => {
  const options = ganttViewOptions();

  it("models the numeric default-duration input as a slider with min 1", () => {
    const duration = byKey(options, "tngantt_defaultDuration");
    expect(duration.type).toBe("slider");
    expect(duration).toMatchObject({
      type: "slider",
      displayName: "Default task duration (days)",
      key: "tngantt_defaultDuration",
      default: 1,
      min: 1,
    });
  });

  it("models the three boolean visibility options as toggles", () => {
    for (const key of [
      "tngantt_showUndatedTasks",
      "tngantt_showPartialDateTasks",
      "tngantt_showDateIndicators",
    ]) {
      const toggle = byKey(options, key);
      expect(toggle.type).toBe("toggle");
      expect(toggle).toMatchObject({ key, default: true });
    }
  });

  it("exposes the show-toolbar toggle, defaulting off (plan 002 R2)", () => {
    const toggle = byKey(options, "tngantt_showToolbar");
    expect(toggle.type).toBe("toggle");
    expect(toggle).toMatchObject({
      type: "toggle",
      displayName: "Show toolbar",
      key: "tngantt_showToolbar",
      default: false,
    });
  });

  it("exposes the scale/arrow/cascade selectors as dropdowns", () => {
    for (const key of [
      "tngantt_defaultScale",
      "tngantt_dependencyArrowMode",
      "tngantt_parentDateCascade",
    ]) {
      const dropdown = byKey(options, key);
      expect(dropdown.type).toBe("dropdown");
      expect("options" in dropdown && typeof dropdown.options).toBe("object");
    }
  });

  it("pins the dropdown defaults and choice maps", () => {
    expect(byKey(options, "tngantt_defaultScale")).toMatchObject({
      default: "day",
      options: { hour: "Hours", day: "Days", week: "Weeks", month: "Months" },
    });
    expect(byKey(options, "tngantt_dependencyArrowMode")).toMatchObject({
      default: "primary",
      options: { primary: "Primary instance only", all: "All instances" },
    });
    expect(byKey(options, "tngantt_parentDateCascade")).toMatchObject({
      default: "ask",
      options: {
        ask: "Ask before updating parent dates",
        auto: "Update parent dates automatically",
        never: "Never update parent dates",
      },
    });
  });

  it("includes the shared field-mapping property options", () => {
    const propertyKeys = options
      .filter((o) => o.type === "property")
      .map((o) => ("key" in o ? o.key : undefined));
    expect(propertyKeys).toEqual([
      FIELD_MAPPING_KEYS.text,
      FIELD_MAPPING_KEYS.start,
      FIELD_MAPPING_KEYS.end,
      FIELD_MAPPING_KEYS.progress,
      FIELD_MAPPING_KEYS.parent,
      FIELD_MAPPING_KEYS.status,
    ]);
  });

  it("never uses the forbidden 'number' or 'boolean' control types", () => {
    for (const option of options) {
      expect(option.type).not.toBe("number");
      expect(option.type).not.toBe("boolean");
    }
  });

  it("has the expected total option count", () => {
    // 6 shared property options + 3 dropdowns + 1 slider + 4 toggles.
    expect(options).toHaveLength(14);
  });
});

describe("taskListViewOptions", () => {
  const options = taskListViewOptions();

  it("returns exactly the six shared field-mapping property options", () => {
    expect(options).toHaveLength(6);
    expect(options.every((o) => o.type === "property")).toBe(true);
    expect(options.map((o) => ("key" in o ? o.key : undefined))).toEqual([
      FIELD_MAPPING_KEYS.text,
      FIELD_MAPPING_KEYS.start,
      FIELD_MAPPING_KEYS.end,
      FIELD_MAPPING_KEYS.progress,
      FIELD_MAPPING_KEYS.parent,
      FIELD_MAPPING_KEYS.status,
    ]);
  });

  it("pins the progress property default and placeholders", () => {
    const progress = byKey(options, FIELD_MAPPING_KEYS.progress);
    expect(progress).toMatchObject({
      type: "property",
      displayName: "Progress Property",
      default: "note.progress",
      placeholder: "Select progress property (0-100)",
    });
    expect(byKey(options, FIELD_MAPPING_KEYS.text)).toMatchObject({
      default: "",
      placeholder: "Select task name property (defaults to file name)",
    });
  });
});
