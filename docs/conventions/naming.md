# Naming Conventions

Aligned with Dave Farley's emphasis on **code as communication** — names should let code read like little sentences that make sense to someone who understands the domain.

## Casing

- Classes / types / interfaces: `PascalCase`
- Functions / variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`

## Variables

- **Intention-revealing**: the name states the intent without a comment.
  - `elapsedTimeInDays` not `d` (`// elapsed time in days`)
  - `sourceEntityData` not `dragData`
  - `userValidationResult` not `result`
- **No mental mapping**: don't make readers decode abbreviations.
  - `customerRepository` not `custRepo`
  - `configurationManager` not `cfgMgr`
- **Searchable**: name the concept, not a magic value.
  - `MAX_RETRY_ATTEMPTS` not `7`
  - `DEFAULT_TIMEOUT_SECONDS` not `30`

## Functions

- **Verb-based**: start with a verb describing the action.
  - `processUserInput()`, `validateConfiguration()`, `calculateTotalPrice()`, `createUser()`, `deletePage()`
  - Not `userData()`, `configuration()`, `price()`
- **Single responsibility reflected in the name**: a name that needs "And" is doing too much.
  - `extractMethodBody()`, `formatUserMessage()`
  - Not `processAndValidateAndSaveUser()`
- **Domain language**: use terms a problem-domain expert would recognize.
  - `addFractions(numerator1, denominator1, numerator2, denominator2)`
  - `decodeParameters(binaryStream)`
