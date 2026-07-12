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
  readHighlightWeekends,
  readBarColorMode,
  readBarColorSource,
  readBarIcon,
  readProgressMode,
  readTimeEstimateMode,
  isProgressReadonly,
  isTimeEstimateWriteEnabled,
  DEFAULT_CONTEXT_OPACITY,
} from "../../src/bases/viewOptions";
import type { FieldMappings } from "../../src/bases/types/field-mapping";
import { FIELD_MAPPING_KEYS } from "../../src/bases/fieldMappingConfig";

/** Flatten one level of option groups into their leaf options (groups don't nest — `BasesOptionGroup<BasesOptions>`). */
function flattenLeaves(options: BasesAllOptions[]): BasesAllOptions[] {
  return options.flatMap((o) => (o.type === "group" ? o.items : [o]));
}

/** Find a single leaf option by its `key`, searching inside groups. */
function byKey(options: BasesAllOptions[], key: string): BasesAllOptions {
  const match = flattenLeaves(options).filter((o) => "key" in o && o.key === key);
  expect(match).toHaveLength(1);
  return match[0];
}

/** Minimal shape of a Bases option group, for group-structure assertions. */
interface OptionGroupLike {
  displayName: string;
  items: BasesAllOptions[];
}

/** The top-level groups in display order; asserts every entry is a group. */
function groupsOf(options: BasesAllOptions[]): OptionGroupLike[] {
  return options.map((o) => {
    expect(o.type).toBe("group");
    return o as OptionGroupLike;
  });
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

  it("exposes the Highlight weekends toggle, defaulting on, in Timeline, in both modes", () => {
    const toggle = byKey(options, "tngantt_highlightWeekends");
    expect(toggle.type).toBe("toggle");
    expect(toggle).toMatchObject({
      type: "toggle",
      displayName: "Highlight weekends",
      key: "tngantt_highlightWeekends",
      default: true,
    });
    const timeline = groupsOf(options).find((g) => g.displayName === "Timeline");
    expect(timeline).toBeDefined();
    expect(
      timeline!.items.some((o) => "key" in o && o.key === "tngantt_highlightWeekends"),
    ).toBe(true);
    // Standalone (no TaskNotes) offers the toggle too — no companion dependency.
    const standalone = ganttViewOptions(false);
    expect(
      flattenLeaves(standalone).some(
        (o) => "key" in o && o.key === "tngantt_highlightWeekends",
      ),
    ).toBe(true);
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

  it("exposes the divider width as a text control in the Appearance group with a placeholder", () => {
    const tableWidth = byKey(options, "tngantt_tableWidth");
    expect(tableWidth.type).toBe("text");
    expect(tableWidth).toMatchObject({ key: "tngantt_tableWidth", default: "" });
    // Placeholder communicates the first-column-fallback auto behavior when unset.
    expect((tableWidth as { placeholder?: string }).placeholder).toBeTruthy();
    const appearance = groupsOf(options).find((g) => g.displayName === "Appearance");
    expect(appearance).toBeDefined();
    expect(appearance!.items.some((o) => "key" in o && o.key === "tngantt_tableWidth")).toBe(true);
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
    const keys = flattenLeaves(standalone).map((o) => ("key" in o ? o.key : undefined));
    // The Relationships section and Progress mode are companion-only (R7).
    expect(keys).not.toContain("tngantt_expandedRelationships");
    expect(keys).not.toContain("tngantt_hideTopLevelSubtasks");
    expect(keys).not.toContain("tngantt_contextOpacity");
    expect(keys).not.toContain("tngantt_progressMode");
    // The whole Relationships group is dropped, not just its items.
    expect(
      standalone.map((g) => ("displayName" in g ? g.displayName : undefined)),
    ).not.toContain("Relationships");
    // Progress Property stays — standalone still maps it to drive progress bars (R7).
    expect(keys).toContain(FIELD_MAPPING_KEYS.progress);
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
    const propertyKeys = flattenLeaves(options)
      .filter((o) => o.type === "property")
      .map((o) => ("key" in o ? o.key : undefined));
    // Progress Property now lives in the Progress group (after the six Fields
    // mappings), so it flattens after the others.
    expect(propertyKeys).toEqual([
      FIELD_MAPPING_KEYS.text,
      FIELD_MAPPING_KEYS.start,
      FIELD_MAPPING_KEYS.end,
      FIELD_MAPPING_KEYS.parent,
      FIELD_MAPPING_KEYS.status,
      FIELD_MAPPING_KEYS.priority,
      // Time Estimate property lives in the Fields group (before the Progress group).
      FIELD_MAPPING_KEYS.timeEstimate,
      FIELD_MAPPING_KEYS.progress,
    ]);
  });

  it("never uses the forbidden 'number' or 'boolean' control types", () => {
    for (const option of flattenLeaves(options)) {
      expect(option.type).not.toBe("number");
      expect(option.type).not.toBe("boolean");
    }
  });

  it("has the expected total option count", () => {
    // Five groups; flattened leaves = 8 Fields + 2 Progress + 3 Relationships
    // + 7 Timeline + 8 Appearance = 28 (8 property + 9 dropdowns + 4 sliders + 6 toggles + 1 text).
    expect(flattenLeaves(options)).toHaveLength(28);
  });

  it("organizes options into five collapsible sections in order (R4)", () => {
    const groups = groupsOf(options);
    expect(groups.map((g) => g.displayName)).toEqual([
      "Fields",
      "Progress",
      "Relationships",
      "Timeline",
      "Appearance",
    ]);
  });

  it("places each option in its section, in the specified order (R2, R3, R5)", () => {
    const groups = groupsOf(options);
    const keysIn = (name: string) =>
      groups
        .find((g) => g.displayName === name)!
        .items.map((o) => ("key" in o ? o.key : undefined));
    // Time Estimate property + companion-only write mode sit in Fields, after the
    // six base mappings.
    expect(keysIn("Fields")).toEqual([
      FIELD_MAPPING_KEYS.text,
      FIELD_MAPPING_KEYS.start,
      FIELD_MAPPING_KEYS.end,
      FIELD_MAPPING_KEYS.parent,
      FIELD_MAPPING_KEYS.status,
      FIELD_MAPPING_KEYS.priority,
      FIELD_MAPPING_KEYS.timeEstimate,
      "tngantt_timeEstimateMode",
    ]);
    // R3: Progress mode immediately follows Progress Property.
    expect(keysIn("Progress")).toEqual([FIELD_MAPPING_KEYS.progress, "tngantt_progressMode"]);
    // R2: the opacity slider sits between Expanded relationships and Hide top-level subtasks.
    expect(keysIn("Relationships")).toEqual([
      "tngantt_expandedRelationships",
      "tngantt_contextOpacity",
      "tngantt_hideTopLevelSubtasks",
    ]);
    expect(keysIn("Timeline")).toEqual([
      "tngantt_defaultScale",
      "tngantt_highlightWeekends",
      "tngantt_defaultDuration",
      "tngantt_dependencyArrowMode",
      "tngantt_parentDateCascade",
      "tngantt_showUndatedTasks",
      "tngantt_showPartialDateTasks",
    ]);
    expect(keysIn("Appearance")).toEqual([
      "tngantt_barColorMode",
      "tngantt_barColorSource",
      "tngantt_barIcon",
      "tngantt_showDateIndicators",
      "tngantt_showToolbar",
      "tngantt_minHeight",
      "tngantt_maxHeight",
      "tngantt_tableWidth",
    ]);
  });

  it("exposes the companion-only Progress mode dropdown, defaulting to TaskNotes when no property is mapped", () => {
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

  it("shows the Progress mode dropdown defaulting to Property when a Progress Property is mapped", () => {
    // The shown default matches readProgressMode's unset resolution so the mode
    // the user sees equals the mode applied (and an explicit TaskNotes choice,
    // differing from this default, persists).
    const withProperty = ganttViewOptions(true, true);
    expect(byKey(withProperty, "tngantt_progressMode")).toMatchObject({ default: "property" });
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

  it("models the companion-only expanded-items opacity as a renamed slider (U1/U6)", () => {
    const opacity = byKey(options, "tngantt_contextOpacity");
    expect(opacity).toMatchObject({
      type: "slider",
      // Renamed label (U1); the config key is unchanged so saved views persist.
      displayName: "Expanded items opacity (%)",
      key: "tngantt_contextOpacity",
      default: 55,
      min: 10,
      max: 100,
      step: 5,
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

describe("readHighlightWeekends", () => {
  it("defaults to true when the toggle is unset (default on)", () => {
    expect(readHighlightWeekends(() => undefined)).toBe(true);
  });

  it("is false only for an explicit boolean false", () => {
    expect(readHighlightWeekends((k) => ({ tngantt_highlightWeekends: false })[k])).toBe(
      false,
    );
    // Falsy-but-not-false and junk values keep the default-on behavior.
    expect(readHighlightWeekends(() => "no")).toBe(true);
    expect(readHighlightWeekends(() => 0)).toBe(true);
    expect(readHighlightWeekends(() => null)).toBe(true);
    expect(readHighlightWeekends(() => true)).toBe(true);
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

  it("defaults a fresh companion view (no property) to tasknotes when unset (R2)", () => {
    expect(
      readProgressMode(unset, { companionAvailable: true, hasProgressProperty: false }),
    ).toBe("tasknotes");
  });

  it("defaults to property when a Progress Property is configured (preserve existing views)", () => {
    // An existing view with a mapped property must NOT silently switch to computed
    // checklist progress on upgrade — the unset default resolves to property.
    expect(
      readProgressMode(unset, { companionAvailable: true, hasProgressProperty: true }),
    ).toBe("property");
  });

  it("defaults to property in standalone mode (the TaskNotes option isn't offered, R3)", () => {
    expect(
      readProgressMode(unset, { companionAvailable: false, hasProgressProperty: false }),
    ).toBe("property");
  });

  it("honors an explicit stored mode when the source is available (explicit tasknotes wins over a mapped property)", () => {
    const property = (k: string) => ({ tngantt_progressMode: "property" })[k];
    const tasknotes = (k: string) => ({ tngantt_progressMode: "tasknotes" })[k];
    expect(
      readProgressMode(property, { companionAvailable: true, hasProgressProperty: false }),
    ).toBe("property");
    // The key case: a view WITH a property that explicitly selects TaskNotes
    // reads the checklist and ignores the property.
    expect(
      readProgressMode(tasknotes, { companionAvailable: true, hasProgressProperty: true }),
    ).toBe("tasknotes");
  });

  it("coalesces an explicit tasknotes selection to property when standalone (R3)", () => {
    const tasknotes = (k: string) => ({ tngantt_progressMode: "tasknotes" })[k];
    expect(
      readProgressMode(tasknotes, { companionAvailable: false, hasProgressProperty: false }),
    ).toBe("property");
  });

  it("treats junk as unset and applies the migration default", () => {
    const junk = () => "nonsense";
    expect(
      readProgressMode(junk, { companionAvailable: true, hasProgressProperty: false }),
    ).toBe("tasknotes");
    expect(
      readProgressMode(junk, { companionAvailable: true, hasProgressProperty: true }),
    ).toBe("property");
  });
});

describe("time estimate options (U2)", () => {
  it("always shows the Time Estimate property, in both companion and standalone modes", () => {
    const companion = byKey(ganttViewOptions(true, false), FIELD_MAPPING_KEYS.timeEstimate);
    const standalone = byKey(ganttViewOptions(false), FIELD_MAPPING_KEYS.timeEstimate);
    expect("type" in companion && companion.type).toBe("property");
    expect("type" in standalone && standalone.type).toBe("property");
  });

  it("offers the Time Estimate Update mode (all three values) only with the companion (R1, R3)", () => {
    const mode = byKey(ganttViewOptions(true, false), "tngantt_timeEstimateMode");
    expect("type" in mode && mode.type).toBe("dropdown");
    expect("options" in mode && mode.options).toEqual({
      "dont-update": "Don't update",
      tasknotes: "TaskNotes field",
      property: "Property",
    });
    expect("default" in mode && mode.default).toBe("dont-update");

    const standaloneMatches = flattenLeaves(ganttViewOptions(false)).filter(
      (o) => "key" in o && o.key === "tngantt_timeEstimateMode",
    );
    expect(standaloneMatches).toHaveLength(0);
  });
});

describe("readTimeEstimateMode", () => {
  const unset = () => undefined;

  it("defaults to dont-update when unset (R1)", () => {
    expect(readTimeEstimateMode(unset, { companionAvailable: true })).toBe("dont-update");
    expect(readTimeEstimateMode(unset, { companionAvailable: false })).toBe("dont-update");
  });

  it("honors an explicit property mode", () => {
    const property = (k: string) => ({ tngantt_timeEstimateMode: "property" })[k];
    expect(readTimeEstimateMode(property, { companionAvailable: true })).toBe("property");
    // Property mode reads/writes a mapped property, so it is valid even standalone
    // (the write is separately gated read-only in standalone by the source).
    expect(readTimeEstimateMode(property, { companionAvailable: false })).toBe("property");
  });

  it("honors tasknotes only with the companion, else coalesces to dont-update (R3)", () => {
    const tasknotes = (k: string) => ({ tngantt_timeEstimateMode: "tasknotes" })[k];
    expect(readTimeEstimateMode(tasknotes, { companionAvailable: true })).toBe("tasknotes");
    expect(readTimeEstimateMode(tasknotes, { companionAvailable: false })).toBe("dont-update");
  });

  it("treats junk as unset (dont-update)", () => {
    expect(readTimeEstimateMode(() => "nonsense", { companionAvailable: true })).toBe("dont-update");
  });
});

describe("isTimeEstimateWriteEnabled (U3/R13-R15)", () => {
  const mappings = (over: Partial<FieldMappings>): FieldMappings =>
    ({ textProperty: "", startProperty: "", endProperty: "", progressProperty: "", ...over } as FieldMappings);

  it("is disabled in dont-update mode (the default) and when the mode is unset (R13)", () => {
    expect(isTimeEstimateWriteEnabled(mappings({ timeEstimateMode: "dont-update" }))).toBe(false);
    expect(isTimeEstimateWriteEnabled(mappings({}))).toBe(false);
  });

  it("is enabled in tasknotes mode (companion-gated upstream by the reader)", () => {
    expect(isTimeEstimateWriteEnabled(mappings({ timeEstimateMode: "tasknotes" }))).toBe(true);
  });

  it("is enabled in property mode only with a mapped Time Estimate property", () => {
    expect(
      isTimeEstimateWriteEnabled(mappings({ timeEstimateMode: "property", timeEstimateProperty: "note.est" })),
    ).toBe(true);
    expect(isTimeEstimateWriteEnabled(mappings({ timeEstimateMode: "property", timeEstimateProperty: "" }))).toBe(false);
    expect(isTimeEstimateWriteEnabled(mappings({ timeEstimateMode: "property" }))).toBe(false);
  });
});

describe("isProgressReadonly", () => {
  const mappings = (over: Partial<FieldMappings>): FieldMappings =>
    ({ textProperty: "", startProperty: "", endProperty: "", progressProperty: "", ...over } as FieldMappings);

  it("is editable only in property mode with a mapped Progress Property", () => {
    expect(isProgressReadonly(mappings({ progressMode: "property", progressProperty: "note.pct" }))).toBe(false);
  });

  it("is read-only in tasknotes mode (computed) even with a property mapped", () => {
    expect(isProgressReadonly(mappings({ progressMode: "tasknotes", progressProperty: "note.pct" }))).toBe(true);
  });

  it("is read-only in property mode with no mapped property (a drag would no-op)", () => {
    expect(isProgressReadonly(mappings({ progressMode: "property", progressProperty: "" }))).toBe(true);
    expect(isProgressReadonly(mappings({ progressMode: "property", progressProperty: "   " }))).toBe(true);
  });

  it("is read-only when the mode is unset", () => {
    expect(isProgressReadonly(mappings({ progressProperty: "note.pct" }))).toBe(true);
  });
});
