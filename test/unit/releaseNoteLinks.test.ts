import { transformReleaseNoteIssueLinks } from "../../src/release/releaseNoteLinks";

const REPO = "https://github.com/renatomen/tasknotes-gantt";

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
