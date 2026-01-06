---
type: "agent_requested"
description:
  "Best practices to be rigorously adopted when creating and maintaining BDD - Behaviour Driven
  Development scenarios and any test scenario"
---

# BDD Best Practices Rules for AugmentCode

## Core BDD Principles

### Focus on Behavior Over Implementation

- Write scenarios that describe **WHAT** the system should do from the user's perspective
- Avoid implementation details and technical "HOW" considerations in scenario descriptions
- Express scenarios in the language of the problem domain (ubiquitous language)
- Think in terms of user goals and outcomes, not button clicks or UI interactions

### Outside-In Development Approach

- Start with acceptance criteria and executable specifications before writing code
- Use BDD scenarios as executable specifications that drive development
- Follow the BDD cycle: Discovery → Formulation → Automation
- Treat scenarios as genuine specifications for the system behavior under controlled circumstances

## Scenario Writing Standards

### Use Proper Given-When-Then Structure

- **Given**: Set up the initial state/context (preconditions)
- **When**: Trigger the specific action or event
- **Then**: Verify the expected outcome/result
- Use "And" to extend any of these sections when needed
- Keep each section focused and clear

### One Behavior Per Scenario

- Each scenario should test exactly one behavior or business rule
- Avoid scenarios that cover multiple requirements simultaneously
- Split complex scenarios into separate, focused scenarios
- Ensure scenarios are independent and can run in isolation

### Write Scenarios in Domain Language

- Use terminology that domain experts and stakeholders understand
- Avoid technical jargon, implementation details, or system internals
- Express scenarios from the external user's perspective
- Use real business concepts, not technical abstractions

### Concrete Examples Over Abstract Descriptions

- Use specific, concrete data in scenarios rather than vague descriptions
- Provide realistic examples that demonstrate the behavior clearly
- Include edge cases and boundary conditions as separate scenarios
- Use meaningful data that reflects real-world usage patterns

## Scenario Organization and Management

### Feature File Structure

- Organize scenarios by high-level business requirements or features
- Use descriptive feature titles that reflect business value
- Group related scenarios logically within feature files
- Keep feature files focused on a single area of functionality

### Consistent Naming Conventions

- Use clear, descriptive titles for features and scenarios
- Focus on the business outcome or user value in titles
- Avoid implementation-focused naming (e.g., "User clicks login button")
- Prefer outcome-focused naming (e.g., "User can access their account")

### File and Folder Organization

- Use a consistent folder structure across the project
- Separate feature files by functional areas or domains
- Consider using prefixes for better searchability and management
- Keep related scenarios and step definitions together

## Domain-Specific Language (DSL) Development

### Four-Layer Architecture

1. **Test Cases**: Scenarios written in domain language
2. **Domain-Specific Language**: Shared vocabulary and methods
3. **Protocol Drivers**: Adapters that translate to system interactions
4. **System Under Test**: The actual system being tested

### DSL Design Principles

- Create reusable methods that express domain concepts
- Use optional parameters to allow precision where needed while skipping unnecessary detail
- Encode common setup tasks (user registration, account population, etc.)
- Keep DSL focused on domain-level concepts, clean from implementation details
- Build DSL pragmatically - start with 2-3 simple test cases and grow organically

### Internal DSL Preference

- Prefer internal DSLs over external parsing tools where possible
- Use existing programming language to host computable grammar
- Create easily readable domain-focused vocabulary
- Ensure non-technical stakeholders can understand the DSL structure

## Test Implementation Guidelines

### Protocol Drivers as Translators

- Create protocol drivers that translate DSL calls to system interactions
- Mirror the DSL interface but with more specific parameters
- Create separate protocol drivers for each communication channel (UI, API, etc.)
- Isolate all test infrastructure knowledge in protocol drivers

### Test Isolation and Independence

- Ensure scenarios don't depend on the outcome of other scenarios
- Make scenarios executable in any order or in parallel
- Use proper setup and teardown procedures
- Avoid shared state between test scenarios

### Environment Management

- Deploy systems using the same tools and techniques as production
- Use Infrastructure-as-Code for test environments
- Ensure test environment is production-like from system perspective
- Optimize system startup time to make testing efficient

## Collaboration and Team Practices

### Three Amigos Collaboration

- Consider perspectives of Product Owners, QA/Testers, and Developers in scenario creation

### Ownership and Maintenance

- Development teams own the executable specifications
- Create acceptance tests for every acceptance criterion
- Drive all new development from these executable specifications

### Continuous Improvement

- Review and refine scenarios regularly
- Keep scenarios aligned with changing requirements
- Remove or update obsolete scenarios
- Learn from scenario failures to improve specification quality

## Anti-Patterns to Avoid

### Common BDD Failures

- Don't focus on tools (Cucumber, SpecFlow) instead of principles
- Don't write scenarios with too much implementation detail

### Testing Anti-Patterns

- Avoid procedure-driven scenarios (step-by-step UI instructions)
- Don't create scenarios that are too high-level and vague
- Don't write scenarios that test multiple behaviors simultaneously
- Don't use technical system concepts in scenario language

### Organization Anti-Patterns

- Don't allow scenarios to become outdated or unmaintained
- Don't treat scenarios as traditional test cases instead of specifications

## Executable Specifications Quality

### Properties of Good Specifications

- Focused on single, clear behavior
- Independent and can run in isolation
- Expressed in domain language
- Provide fast, reliable feedback
- Act as living documentation of system behavior
- Remain stable despite implementation changes

### Specification Maintenance

- Keep specifications up-to-date with system changes
- Refactor specifications when domain language evolves
- Remove redundant or obsolete specifications
- Ensure specifications continue to provide value to the team

### Living Documentation

- Use scenarios as the primary source of behavior documentation
- Keep scenarios readable by both technical and non-technical stakeholders
- Ensure scenarios accurately reflect current system capabilities
- Use scenarios to communicate requirements and system behavior

## Integration with Development Process

### Test-First Development

- Write scenarios before implementing functionality
- Use failing scenarios to drive implementation decisions
- Implement only enough to make scenarios pass
- Use scenarios to guide refactoring and system evolution

### Continuous Integration

- Include scenario execution in CI/CD pipelines
- Ensure scenarios provide fast feedback on system behavior
- Use scenario results to make deployment decisions
- Maintain scenario execution speed for rapid feedback

### Documentation and Communication

- Use scenarios to communicate with stakeholders about system behavior
- Keep scenarios as the definitive source of functional requirements
- Use scenario outcomes to demonstrate system readiness
