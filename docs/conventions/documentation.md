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
