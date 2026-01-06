# AssertThat ID Tracking System

## Overview

This document describes the AssertThat unique ID tracking system that enables reliable bidirectional sync between GitHub and AssertThat, even when feature/scenario names change.

## Problem Statement

**Original Issue:** File matching based solely on filename is fragile and breaks when:
- Feature names change
- Scenario names change
- Files are renamed or moved
- Features are reorganized

**Solution:** Use AssertThat's unique IDs as stable identifiers stored in feature file comments.

## AssertThat API Response

AssertThat provides unique IDs for each scenario in the API response:

```json
{
  "scenarios": [
    {
      "id": "0e35e68f664b0a2aec4cd33289a19889",
      "name": "Basic task creation and rendering",
      "feature": "BDD Framework Validation",
      "mode": "automated",
      "steps": "Given a task...",
      "created_at": "2025-10-02T08:11:11",
      "updated_at": "2025-10-03T00:51:58",
      "issues": [],
      "tags": ["imported-from-github"]
    }
  ]
}
```

## Metadata Format

### Feature-Level ID

Stored as a comment before the `Feature:` declaration:

```gherkin
# @assertthat-feature-id: BDD Framework Validation
Feature: BDD Framework Validation
  As a developer...
```

### Scenario-Level ID

Stored as a comment before the `Scenario:` declaration:

```gherkin
  # @assertthat-scenario-id: 0e35e68f664b0a2aec4cd33289a19889
  Scenario: Basic task creation and rendering
    Given a task with title "Sample Task 9"
    When I add the task to the chart
    Then the task should be visible
```

### With Tags

IDs work seamlessly with Gherkin tags:

```gherkin
  # @assertthat-scenario-id: abc123def456
  @smoke @automated
  Scenario: Tagged Scenario
    Given a precondition
```

## FeatureMetadataManager API

### Extract Metadata from Feature File

```javascript
import { FeatureMetadataManager } from './scripts/metadata/FeatureMetadataManager.mjs';

const manager = new FeatureMetadataManager();

const content = await fs.readFile('features/test.feature', 'utf-8');
const metadata = manager.extractMetadata(content);

console.log(metadata);
// {
//   featureId: 'BDD Framework Validation',
//   scenarioIds: Map {
//     'Basic task creation and rendering' => '0e35e68f664b0a2aec4cd33289a19889',
//     'Multiple tasks rendering' => 'abc123def456'
//   }
// }
```

### Update Metadata in Feature File

```javascript
const metadata = {
  featureId: 'BDD Framework Validation',
  scenarioIds: new Map([
    ['Basic task creation', '0e35e68f664b0a2aec4cd33289a19889'],
    ['Multiple tasks', 'abc123def456'],
  ]),
};

const updated = manager.updateMetadata(content, metadata);
await fs.writeFile('features/test.feature', updated, 'utf-8');
```

### Extract from AssertThat API Response

```javascript
const apiResponse = await assertThatClient.getScenarios();
const metadata = manager.extractFromApiResponse(apiResponse);

// Automatically extracts IDs from API response
```

### Create Scenario Mapping

```javascript
const githubFeatures = [
  { path: 'test.feature', content: '...' }
];

const assertThatScenarios = apiResponse.scenarios;

const mapping = manager.createScenarioMapping(githubFeatures, assertThatScenarios);

// Map<scenarioId, { github, assertThat }>
for (const [id, pair] of mapping) {
  if (pair.github && pair.assertThat) {
    console.log(`Matched: ${id}`);
  } else if (!pair.github) {
    console.log(`New from AssertThat: ${id}`);
  } else {
    console.log(`Deleted from AssertThat: ${id}`);
  }
}
```

## Sync Workflow Integration

### Initial ID Assignment

When syncing for the first time:

1. Upload all GitHub features to AssertThat
2. Download features from AssertThat (now with IDs)
3. Extract IDs from API response
4. Update GitHub feature files with IDs
5. Commit metadata changes

### Subsequent Syncs

1. Download features from AssertThat to staging
2. Load GitHub features
3. Create mapping by AssertThat ID (not filename!)
4. For each matched pair:
   - Compare content
   - Detect changes
   - Resolve conflicts
   - Update as needed
5. Handle new scenarios (no GitHub match)
6. Handle deleted scenarios (no AssertThat match)

## Benefits

### ✅ Resilient to Name Changes

```gherkin
# Before (GitHub)
# @assertthat-scenario-id: abc123
Scenario: Old Name
  Given something

# After (AssertThat)
# @assertthat-scenario-id: abc123
Scenario: New Name
  Given something
```

Sync correctly identifies these as the same scenario despite name change.

### ✅ Resilient to File Moves

```
# Before
features/bdd-framework/framework-validation.feature

# After
features/framework-validation.feature
```

ID-based matching works regardless of file location.

### ✅ Handles Deletions

```javascript
const mapping = manager.createScenarioMapping(githubFeatures, assertThatScenarios);

for (const [id, pair] of mapping) {
  if (!pair.assertThat) {
    console.log(`Scenario ${id} deleted from AssertThat`);
    // Prompt user or auto-delete from GitHub
  }
}
```

### ✅ Handles New Scenarios

```javascript
for (const [id, pair] of mapping) {
  if (!pair.github) {
    console.log(`New scenario ${id} from AssertThat`);
    // Create new file in GitHub
  }
}
```

## Testing

Comprehensive test suite with 13 tests covering:

- ✅ Feature ID extraction
- ✅ Scenario ID extraction
- ✅ Handling tags
- ✅ Metadata updates
- ✅ Preserving indentation
- ✅ API response parsing
- ✅ Scenario mapping
- ✅ Name change detection
- ✅ New scenario detection

Run tests:

```bash
npm test test/unit/feature-metadata-manager.test.ts
```

## Next Steps

1. **Flatten GitHub Structure** - Move all features to `features/` root (AssertThat limitation)
2. **Initial ID Assignment** - Upload to AssertThat, download with IDs, commit metadata
3. **Update Sync Logic** - Use `FeatureMetadataManager` for ID-based matching
4. **Add to .gitignore** - Add `featureSyncStage/` to prevent staging dir commits
5. **Re-enable Cleanup** - Remove debug code that keeps staging directory

## References

- **Implementation**: `scripts/metadata/FeatureMetadataManager.mjs`
- **Tests**: `test/unit/feature-metadata-manager.test.ts`
- **AssertThat API**: `docs/assertthat-api-v2.md`
- **Original Requirements**: Jira OG-26 comments 10070, 10071

