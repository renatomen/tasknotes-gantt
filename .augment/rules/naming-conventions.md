---
type: "agent_requested"
description: "Naming standards aligned with Dave Farley's emphasis on code as communication"
---

# Naming Conventions

## Core Principle: Code as Communication

Names should allow code to read like "little sentences that make sense". Code should be readable
even by someone who understands the problem domain but isn't necessarily a programmer.

## Variable Naming

- **Intention-Revealing Names**: Names should reveal intent without requiring comments
  - GOOD: `elapsedTimeInDays` instead of `d // elapsed time in days`
  - GOOD: `sourceEntityData` instead of `dragData`
  - GOOD: `userValidationResult` instead of `result`

- **Avoid Mental Mapping**: Don't make readers decode abbreviations
  - GOOD: `customerRepository` not `custRepo`
  - GOOD: `configurationManager` not `cfgMgr`
  - GOOD: `parameterDecoder` not `paramDec`

- **Searchable Names**: Use names that can be easily found in codebase
  - GOOD: `MAX_RETRY_ATTEMPTS` not magic number `7`
  - GOOD: `DEFAULT_TIMEOUT_SECONDS` not magic number `30`

## Function Naming

- **Verb-Based Names**: Functions should start with verbs describing their action
  - GOOD: `processUserInput()`, `validateConfiguration()`, `calculateTotalPrice()`
  - GOOD: `createUser()`, `deletePage()`, `save()`
  - BAD: `userData()`, `configuration()`, `price()`

- **Single Responsibility in Names**: Function names should reflect they do "one thing"
  - GOOD: `selectParameterDecoder()` - clearly focused task
  - GOOD: `extractMethodBody()`, `formatUserMessage()`
  - BAD: `processAndValidateAndSaveUser()` - doing too many things

- **Context-Appropriate Language**: Use domain terminology that makes sense to problem experts
  - GOOD: `addFractions(numerator1, denominator1, numerator2, denominator2)`
  - GOOD: `decodeParameters(binaryStream)`
