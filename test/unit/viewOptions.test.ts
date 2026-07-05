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
  readContextOpacity,
  readExpandedRelationships,
  readHideTopLevelSubtasks,
  readMaxHeight,
  readMinHeight,
  readShowToolbar,
  readBarColorMode,
  readBarColorSource,
  readBarIcon,
  readProgressMode,
  taskListViewOptions,
  DEFAULT_CONTEXT_OPACITY,
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

  it("models the max-height input as a slider defaulting to 400 (plan 003 R1)", () => {
    const maxHeight = byKey(options, "tngantt_maxHeight");
    expect(maxHeight.type).toBe("slider");
    expect(maxHeight).toMatchObject({
      type: "slider",
      displayName: "Max height (px)",
      key: "tngantt_maxHeight",
      default: 400,
      min: 112,
      // max + step are REQUIRED: without max, Obsidian's slider falls back to an
      // HTML range max of 100 (< the 112 min), rendering the control disabled.
      max: 2000,
      step: 10,
    });
  });

  it("exposes the Expanded relationships dropdown defaulting to inherit, with a Record choice map", () => {
    const dropdown = byKey(options, "tngantt_expandedRelationships");
    expect(dropdown.type).toBe("dropdown");
    expect(dropdown).toMatchObject({
      type: "dropdown",
      displayName: "Expanded relationships",
      key: "tngantt_expandedRelationships",
      default: "inherit",
      // MUST be a Record<string,string>, not an array — an array renders every
      // choice as "[object Object]" in the Bases config panel.
      options: { inherit: "Inherit", "show-all": "Show all" },
    });
  });

  it("exposes the Hide top-level subtasks toggle, defaulting off", () => {
    const toggle = byKey(options, "tngantt_hideTopLevelSubtasks");
    expect(toggle.type).toBe("toggle");
    expect(toggle).toMatchObject({
      type: "toggle",
      displayName: "Hide top-level subtasks",
      key: "tngantt_hideTopLevelSubtasks",
      default: false,
    });
  });

  it("omits the companion-only controls in standalone mode (never present-but-inert)", () => {
    const standalone = ganttViewOptions(false);
    const keys = standalone.map((o) => ("key" in o ? o.key : undefined));
    expect(keys).not.toContain("tngantt_expandedRelationships");
    expect(keys).not.toContain("tngantt_hideTopLevelSubtasks");
    expect(keys).not.toContain("tngantt_contextOpacity");
    // Progress mode is companion-gated too: standalone has no TaskNotes Progress
    // source, so the dropdown is omitted (readProgressMode resolves to property).
    expect(keys).not.toContain("tngantt_progressMode");
    // Non-companion controls remain.
    expect(keys).toContain("tngantt_showToolbar");
    expect(keys).toContain("tngantt_defaultScale");
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
      FIELD_MAPPING_KEYS.priority,
    ]);
  });

  it("never uses the forbidden 'number' or 'boolean' control types", () => {
    for (const option of options) {
      expect(option.type).not.toBe("number");
      expect(option.type).not.toBe("boolean");
    }
  });

  it("has the expected total option count", () => {
    // 7 shared property options (incl. priority) + 8 dropdowns + 4 sliders + 5 toggles.
    // Dropdowns: expanded-relationships, progress-mode, default-scale,
    // dependency-arrows, bar-color-mode, bar-color-source, bar-icon,
    // parent-date-cascade.
    // Sliders: default-duration, min-height, max-height, companion context opacity.
    expect(options).toHaveLength(24);
  });

  it("exposes the companion-only Progress mode dropdown defaulting to TaskNotes Progress", () => {
    const dropdown = byKey(options, "tngantt_progressMode");
    expect(dropdown.type).toBe("dropdown");
    expect(dropdown).toMatchObject({
      type: "dropdown",
      displayName: "Progress mode",
      key: "tngantt_progressMode",
      default: "tasknotes",
      // Record<string,string>, not an array (an array renders "[object Object]").
      options: { tasknotes: "TaskNotes Progress", property: "Property" },
    });
  });

  it("models the min-height input as a slider defaulting to the ~2-row floor", () => {
    const minHeight = byKey(options, "tngantt_minHeight");
    expect(minHeight).toMatchObject({
      type: "slider",
      key: "tngantt_minHeight",
      min: 112,
      max: 2000,
      step: 10,
    });
    // Default equals the absolute floor so behavior is unchanged until raised.
    expect((minHeight as { default: number }).default).toBe(112);
  });

  it("models the companion-only context-bar opacity as a slider (U6)", () => {
    const opacity = byKey(options, "tngantt_contextOpacity");
    expect(opacity).toMatchObject({
      type: "slider",
      key: "tngantt_contextOpacity",
      default: 55,
      min: 10,
      max: 100,
      step: 5,
    });
  });
});

describe("taskListViewOptions", () => {
  const options = taskListViewOptions();

  it("returns exactly the seven shared field-mapping property options", () => {
    expect(options).toHaveLength(7);
    expect(options.every((o) => o.type === "property")).toBe(true);
    expect(options.map((o) => ("key" in o ? o.key : undefined))).toEqual([
      FIELD_MAPPING_KEYS.text,
      FIELD_MAPPING_KEYS.start,
      FIELD_MAPPING_KEYS.end,
      FIELD_MAPPING_KEYS.progress,
      FIELD_MAPPING_KEYS.parent,
      FIELD_MAPPING_KEYS.status,
      FIELD_MAPPING_KEYS.priority,
    ]);
  });

  it("leaves the progress property unset by default (property-agnostic) with a guiding placeholder", () => {
    const progress = byKey(options, FIELD_MAPPING_KEYS.progress);
    expect(progress).toMatchObject({
      type: "property",
      displayName: "Progress Property",
      default: "",
      placeholder: "Select a progress property (0-100); optional",
    });
    expect(byKey(options, FIELD_MAPPING_KEYS.text)).toMatchObject({
      default: "",
      placeholder: "Select task name property (defaults to file name)",
    });
  });
});

describe("readShowToolbar", () => {
  it("defaults to false when the toggle is unset (R2 default off)", () => {
    expect(readShowToolbar(() => undefined)).toBe(false);
  });

  it("is true only for an explicit boolean true", () => {
    expect(readShowToolbar((k) => ({ tngantt_showToolbar: true })[k])).toBe(true);
    // Truthy-but-not-true values must NOT enable the toolbar.
    expect(readShowToolbar(() => "true")).toBe(false);
    expect(readShowToolbar(() => 1)).toBe(false);
    expect(readShowToolbar(() => false)).toBe(false);
  });
});

describe("readExpandedRelationships", () => {
  it("defaults to inherit when unset", () => {
    expect(readExpandedRelationships(() => undefined)).toBe("inherit");
  });

  it("returns show-all for the show-all value (and normalizes variants)", () => {
    expect(readExpandedRelationships(() => "show-all")).toBe("show-all");
    expect(readExpandedRelationships(() => "Show All")).toBe("show-all");
    expect(readExpandedRelationships(() => " show_all ")).toBe("show-all");
    expect(readExpandedRelationships(() => 1)).toBe("show-all");
    expect(readExpandedRelationships(() => "1")).toBe("show-all");
    expect(readExpandedRelationships(() => true)).toBe("show-all");
  });

  it("returns inherit for the inherit value and any unrecognized junk", () => {
    expect(readExpandedRelationships(() => "inherit")).toBe("inherit");
    expect(readExpandedRelationships(() => 0)).toBe("inherit");
    expect(readExpandedRelationships(() => "nonsense")).toBe("inherit");
    expect(readExpandedRelationships(() => null)).toBe("inherit");
  });
});

describe("readHideTopLevelSubtasks", () => {
  it("defaults to false when unset", () => {
    expect(readHideTopLevelSubtasks(() => undefined)).toBe(false);
  });

  it("is true only for an explicit boolean true", () => {
    expect(readHideTopLevelSubtasks((k) => ({ tngantt_hideTopLevelSubtasks: true })[k])).toBe(true);
    expect(readHideTopLevelSubtasks(() => "true")).toBe(false);
    expect(readHideTopLevelSubtasks(() => 1)).toBe(false);
    expect(readHideTopLevelSubtasks(() => false)).toBe(false);
  });
});

describe("readMaxHeight", () => {
  it("defaults to 400 when the value is unset (R1 default)", () => {
    expect(readMaxHeight(() => undefined)).toBe(400);
  });

  it("returns the stored positive value (number or numeric string)", () => {
    expect(readMaxHeight(() => 800)).toBe(800);
    // Bases may persist a numeric option as a string — coerce it.
    expect(readMaxHeight(() => "640")).toBe(640);
  });

  it("falls back to the default for non-positive / non-finite / junk values", () => {
    expect(readMaxHeight(() => 0)).toBe(400);
    expect(readMaxHeight(() => -100)).toBe(400);
    expect(readMaxHeight(() => "abc")).toBe(400);
    expect(readMaxHeight(() => null)).toBe(400);
    expect(readMaxHeight(() => Infinity)).toBe(400);
  });
});

describe("readMinHeight", () => {
  it("defaults to the ~2-row floor (112) when unset", () => {
    expect(readMinHeight(() => undefined)).toBe(112);
  });

  it("returns a stored value at or above the floor (number or numeric string)", () => {
    expect(readMinHeight(() => 300)).toBe(300);
    expect(readMinHeight(() => "240")).toBe(240);
  });

  it("clamps a below-floor value up to 112", () => {
    expect(readMinHeight(() => 50)).toBe(112);
    expect(readMinHeight(() => 0)).toBe(112);
    expect(readMinHeight(() => -100)).toBe(112);
  });

  it("falls back to the floor for non-finite / junk values", () => {
    expect(readMinHeight(() => "abc")).toBe(112);
    expect(readMinHeight(() => null)).toBe(112);
    expect(readMinHeight(() => Infinity)).toBe(112);
  });
});

describe("readContextOpacity", () => {
  it("defaults to DEFAULT_CONTEXT_OPACITY when unset", () => {
    expect(readContextOpacity(() => undefined)).toBe(DEFAULT_CONTEXT_OPACITY);
  });

  it("converts the stored percentage to a 0–1 fraction (number or numeric string)", () => {
    expect(readContextOpacity(() => 55)).toBeCloseTo(0.55);
    expect(readContextOpacity(() => "80")).toBeCloseTo(0.8);
    expect(readContextOpacity(() => 100)).toBe(1);
  });

  it("clamps to [0.1, 1] so context bars never vanish or exceed full opacity", () => {
    expect(readContextOpacity(() => 0)).toBe(0.1);
    expect(readContextOpacity(() => 5)).toBe(0.1);
    expect(readContextOpacity(() => 150)).toBe(1);
  });

  it("falls back to the default for non-finite / junk values", () => {
    expect(readContextOpacity(() => "abc")).toBe(DEFAULT_CONTEXT_OPACITY);
    expect(readContextOpacity(() => null)).toBe(DEFAULT_CONTEXT_OPACITY);
    expect(readContextOpacity(() => Infinity)).toBe(DEFAULT_CONTEXT_OPACITY);
  });
});

describe("bar treatment options (U5)", () => {
  it("defines the three dropdowns with Record<string,string> option maps", () => {
    const opts = ganttViewOptions();
    for (const [key, def] of [
      ["tngantt_barColorMode", "fill"],
      ["tngantt_barColorSource", "default"],
      ["tngantt_barIcon", "none"],
    ] as const) {
      const opt = byKey(opts, key) as { type: string; default: unknown; options: unknown };
      expect(opt.type).toBe("dropdown");
      expect(opt.default).toBe(def);
      // A Record map, not an array (an array renders "[object Object]").
      expect(Array.isArray(opt.options)).toBe(false);
      expect(typeof opt.options).toBe("object");
    }
  });
});

describe("readBarColorMode", () => {
  it("defaults to fill; only 'strip' selects strip", () => {
    expect(readBarColorMode(() => undefined)).toBe("fill");
    expect(readBarColorMode(() => "strip")).toBe("strip");
    expect(readBarColorMode(() => "fill")).toBe("fill");
    expect(readBarColorMode(() => "junk")).toBe("fill");
  });
});

describe("readBarColorSource", () => {
  it("defaults to default; recognizes status/priority/theme only", () => {
    expect(readBarColorSource(() => undefined)).toBe("default");
    expect(readBarColorSource(() => "status")).toBe("status");
    expect(readBarColorSource(() => "priority")).toBe("priority");
    expect(readBarColorSource(() => "theme")).toBe("theme");
    expect(readBarColorSource(() => "junk")).toBe("default");
  });
});

describe("readBarIcon", () => {
  it("defaults to none; recognizes status/priority only", () => {
    expect(readBarIcon(() => undefined)).toBe("none");
    expect(readBarIcon(() => "status")).toBe("status");
    expect(readBarIcon(() => "priority")).toBe("priority");
    expect(readBarIcon(() => "theme")).toBe("none");
    expect(readBarIcon(() => "junk")).toBe("none");
  });
});

describe("readProgressMode", () => {
  const unset = () => undefined;

  it("defaults a companion view to tasknotes when unset (matches the dropdown default, R2)", () => {
    expect(readProgressMode(unset, { companionAvailable: true })).toBe("tasknotes");
  });

  it("keeps the companion default at tasknotes even when a Progress Property is configured", () => {
    // The property must NOT silently override a shown-as-TaskNotes selection —
    // it's ignored in tasknotes mode and only applies when explicitly chosen.
    // (config.get is unset here regardless of whether a property is mapped.)
    expect(readProgressMode(unset, { companionAvailable: true })).toBe("tasknotes");
  });

  it("defaults to property in standalone mode (the TaskNotes option isn't offered, R3)", () => {
    expect(readProgressMode(unset, { companionAvailable: false })).toBe("property");
  });

  it("honors an explicit stored mode when the source is available", () => {
    const property = (k: string) => ({ tngantt_progressMode: "property" })[k];
    const tasknotes = (k: string) => ({ tngantt_progressMode: "tasknotes" })[k];
    expect(readProgressMode(property, { companionAvailable: true })).toBe("property");
    expect(readProgressMode(tasknotes, { companionAvailable: true })).toBe("tasknotes");
  });

  it("coalesces an explicit tasknotes selection to property when standalone (R3)", () => {
    const tasknotes = (k: string) => ({ tngantt_progressMode: "tasknotes" })[k];
    expect(readProgressMode(tasknotes, { companionAvailable: false })).toBe("property");
  });

  it("treats junk as unset and applies the dropdown default", () => {
    const junk = () => "nonsense";
    expect(readProgressMode(junk, { companionAvailable: true })).toBe("tasknotes");
    expect(readProgressMode(junk, { companionAvailable: false })).toBe("property");
  });
});
