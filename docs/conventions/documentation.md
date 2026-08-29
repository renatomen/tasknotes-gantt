# Documentation

## Code comments

**Default to no comment.** A comment that explains *what* or *how* the code does
something is a smell — the code should be self-explanatory. Refactor for
readability (better names, structure, extraction) instead. Comments are the rare
exception, not the norm.

- **Keep only a *why* the code can't express** — rationale, a caveat, an
  invariant, an external-bug workaround, "looks wrong but is correct because…".
  If it can be expressed in code, do that; if it genuinely can't, the comment is
  right and stays, co-located with the code.
- **JSDoc for public methods, classes, and interfaces is fine** — that's API
  documentation, not a smell.
- **Never cite volatile references in a comment** — no plan/decision IDs
  (`KTD3`, `AE7`), issue numbers, `file:line` citations, or `see docs/…`. They
  rot when the target moves or is deleted. A comment must stand on its own.
- Keep the comments that remain in sync with the code they describe.
- When you feel the urge: ~99% of the time refactor instead; if a *why* is real,
  keep it in code; if refactoring is too intrusive for the change, leave a PR
  review comment on the line; if the point is durable/architectural, put it in a
  doc (here or `docs/solutions/`), not a line-local comment.

A narrow pre-commit hook flags volatile references mechanically; the "rare,
why-only" judgment is enforced at review.

## API Documentation

- Document all public interfaces.
- Include usage examples for non-obvious functions.
- Specify parameter types and return values.
- Document error conditions and exceptions.

## README & Project Docs

- Keep installation and setup instructions current.
- Document architectural decisions (and link to `docs/solutions/` learnings where relevant).
- Provide a troubleshooting section.

## Quoting external works

The engineering charter and several reports draw on Dave Farley's *Modern Software Engineering: Doing What Works to Build Better Software Faster* (Addison-Wesley, 2021). Quoting it to argue a design decision is the point — the charter names it as lineage — but quotation stays bounded and acknowledged.

- **Cite the work, not just the chapter.** First reference in a document gives author, title and year; later ones may shorten to a chapter or section. A quote with no attributable source is the defect, not a long quote with one.
- **Quote briefly, and for commentary.** Quote the sentence the argument turns on, then say what it means *for this codebase*. If a passage is being reproduced so a reader need not consult the book, it is too long — paraphrase and cite instead.
- **Never commit the source text.** The book, transcripts, or any substantial excerpt of a third-party work do not enter this repository, in any file, including plans, reports and test fixtures. Agents that consult such a source from a local copy carry the *conclusion* back, not the text.
- **The same rule binds agent output.** A review, audit or plan produced by an agent is repository content: its quotations are held to the lines above, and a finding that reproduces long passages is rewritten before it lands.

Measured at the 2026-08-29 audit: ~197 verbatim words across the whole repository, longest single quote 33 words, against a ~90,000-word book — brief quotation for commentary, each attributed. That is the intended order of magnitude; a PR that moves it materially says why.

The same standard applies to any third-party work — SVAR's and Obsidian's documentation included.
