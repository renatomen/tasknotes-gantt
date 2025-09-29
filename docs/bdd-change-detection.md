# BDD Change Detection (OG-40)

## Overview

The BDD Change Detection system optimizes CI pipeline performance by only running BDD validation and
processing when relevant files have changed. This prevents unnecessary processing of unchanged
feature files and reduces CI execution time.

## How It Works

### Change Detection Script

The `scripts/detect-bdd-changes.mjs` script analyzes git changes and determines if BDD-related files
have been modified:

```bash
npm run detect:bdd-changes
```

### Detected File Patterns

The system monitors changes to:

- **Feature Files**: `features/**/*.feature`
- **BDD Configuration**: `.bdd/**/*`
- **BDD Scripts**: `scripts/*bdd*.mjs`, validation, generator, semantic tag manager
- **Pre-commit Hooks**: `.husky/pre-commit`
- **Dependencies**: `package.json`
- **Test Files**: `test/**/*.feature`, `test/step-definitions/**/*`

### CI Integration

The GitHub Actions workflow includes conditional BDD validation:

```yaml
- name: Check BDD changes
  id: bdd-changes
  run: |
    if npm run detect:bdd-changes; then
      echo "bdd-changed=true" >> $GITHUB_OUTPUT
    else
      echo "bdd-changed=false" >> $GITHUB_OUTPUT
    fi
  continue-on-error: true

- name: Validate BDD files
  if: steps.bdd-changes.outputs.bdd-changed == 'true'
  run: npm run validate:bdd
```

## Benefits

### Performance Optimization

- **Faster CI**: Skips BDD validation when only source code changes
- **Resource Efficiency**: Reduces unnecessary processing overhead
- **Targeted Validation**: Only validates when BDD files actually change

### Example Scenarios

#### Scenario 1: Source Code Changes Only

```
Changed files:
- src/main.ts
- src/components/GanttView.svelte
- README.md

Result: BDD validation skipped ⏭️
```

#### Scenario 2: BDD Changes Detected

```
Changed files:
- features/gantt-visualization/task-rendering.feature
- .bdd/semantic-tags.yaml
- src/main.ts

Result: BDD validation runs ✅
```

## Usage

### Manual Testing

Test the change detection locally:

```bash
# Check current changes
npm run detect:bdd-changes

# Test with specific files (for development)
git add features/test.feature
npm run detect:bdd-changes
```

### CI Workflow

The system automatically runs in GitHub Actions:

1. **Build Job**: Quick BDD change check in main build
2. **BDD Validation Job**: Dedicated job that runs conditionally
3. **Artifact Upload**: Collects BDD validation results when run

### Output Examples

#### When BDD Changes Detected:

```
🔍 OG-40: Detecting BDD file changes...

📋 Total changed files: 5

📊 BDD Change Detection Results:
   🏷️  Semantic tags changed: Yes
   📝 Feature files changed: 2
   🔧 BDD tooling changed: Yes

✅ BDD-related changes detected:
   - features/gantt-visualization/task-rendering.feature
   - .bdd/semantic-tags.yaml
   - scripts/validate-bdd-syntax.mjs

🚀 BDD validation and processing will run
```

#### When No BDD Changes:

```
🔍 OG-40: Detecting BDD file changes...

📋 Total changed files: 3

📊 BDD Change Detection Results:
   🏷️  Semantic tags changed: No
   📝 Feature files changed: 0
   🔧 BDD tooling changed: No

⏭️ No BDD-related changes detected, skipping BDD validation
```

## Configuration

### Customizing Detection Patterns

Edit `scripts/detect-bdd-changes.mjs` to modify the detection patterns:

```javascript
const bddPatterns = [
  /^features\/.*\.feature$/, // Feature files
  /^\.bdd\/.*$/, // BDD configuration
  /^scripts\/.*bdd.*\.m?js$/, // BDD scripts
  // Add custom patterns here
];
```

### CI Workflow Customization

Modify `.github/workflows/ci.yml` to adjust the conditional logic:

```yaml
- name: Custom BDD validation
  if: steps.bdd-changes.outputs.bdd-changed == 'true'
  run: |
    echo "Running custom BDD validation"
    npm run validate:bdd
    npm run test:bdd
```

## Testing

The change detection logic is tested in `test/unit/bdd-change-detection.test.ts`:

```bash
npm test test/unit/bdd-change-detection.test.ts
```

## Integration with Other Tools

### Semantic Tag Validation

When semantic tag registry changes, the system:

- Validates all existing feature files against new tags
- Ensures tag compliance across the codebase
- Provides suggestions for tag updates

### AssertThat Integration

Future integration (OG-26, OG-27) will use change detection to:

- Upload only modified feature files to AssertThat
- Sync test results for changed scenarios
- Optimize API calls and reduce processing time

## Troubleshooting

### Common Issues

1. **Git History Missing**: Ensure full git history in CI

   ```yaml
   - uses: actions/checkout@v4
     with:
       fetch-depth: 0 # Fetch full history
   ```

2. **False Positives**: Check file patterns if unexpected files trigger BDD validation

3. **False Negatives**: Verify that all BDD-related file patterns are included

### Debug Mode

Add debug output to the change detection script:

```bash
# Set debug environment variable
DEBUG=1 npm run detect:bdd-changes
```

## Related Tasks

- **OG-37**: Pre-commit BDD validation
- **OG-38**: BDD feature template generator
- **OG-39**: Semantic tagging system
- **OG-26**: AssertThat scenario upload (future)
- **OG-27**: AssertThat test result sync (future)
