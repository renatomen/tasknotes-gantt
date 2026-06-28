import { transformReleaseNoteIssueLinks } from "../../src/release/releaseNoteLinks";
import { defaultExpandedIndices } from "../../src/release/releaseNotesExpand";

const REPO = "https://github.com/renatomen/tasknotes-gantt";

describe("defaultExpandedIndices", () => {
  it("expands the current entry and its first prior", () => {
    const bundle = [{ isCurrent: true }, { isCurrent: false }, { isCurrent: false }];
    expect(defaultExpandedIndices(bundle)).toEqual(new Set([0, 1]));
  });

  it("expands only the current entry when it is last", () => {
    const bundle = [{ isCurrent: false }, { isCurrent: true }];
    expect(defaultExpandedIndices(bundle)).toEqual(new Set([1]));
  });

  it("expands the single entry of a one-version bundle", () => {
    expect(defaultExpandedIndices([{ isCurrent: false }])).toEqual(new Set([0]));
  });

  it("falls back to the first entry when none is current (dev build)", () => {
    const bundle = [{ isCurrent: false }, { isCurrent: false }];
    expect(defaultExpandedIndices(bundle)).toEqual(new Set([0]));
  });

  it("returns an empty set for an empty bundle", () => {
    expect(defaultExpandedIndices([])).toEqual(new Set());
  });
});

describe("transformReleaseNoteIssueLinks", () => {
  it("links a single issue ref, keeping the parentheses", () => {
    expect(transformReleaseNoteIssueLinks("- (#123) fixed it", REPO)).toBe(
      `- ([#123](${REPO}/issues/123)) fixed it`,
    );
  });

  it("links each ref in a multi-ref group", () => {
    expect(transformReleaseNoteIssueLinks("(#12, #34) done", REPO)).toBe(
      `([#12](${REPO}/issues/12), [#34](${REPO}/issues/34)) done`,
    );
  });

  it("does not touch a '#' mid-word or a bare unparenthesized #ref", () => {
    expect(transformReleaseNoteIssueLinks("issue #123 and foo#5", REPO)).toBe("issue #123 and foo#5");
  });

  it("leaves refs inside inline and fenced code untouched", () => {
    expect(transformReleaseNoteIssueLinks("use `(#5)` literally", REPO)).toBe("use `(#5)` literally");
    expect(transformReleaseNoteIssueLinks("```\n(#7)\n```", REPO)).toBe("```\n(#7)\n```");
  });

  it("is idempotent (already-linked refs are not re-wrapped)", () => {
    const once = transformReleaseNoteIssueLinks("- (#9) x", REPO);
    expect(transformReleaseNoteIssueLinks(once, REPO)).toBe(once);
  });
});
