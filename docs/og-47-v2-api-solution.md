# OG-47: V2 API Solution for Unique ID Tracking

**Date:** 2025-10-03  
**Branch:** OG-8-bdd-testing-framework-cont-2  
**Status:** Solution Identified - Ready for Implementation

---

## Problem Summary

From OG-47 comment 10165, a critical blocker was discovered:

- AssertThat API v1 does NOT expose scenario IDs
- Downloaded feature files do NOT contain IDs
- `/scenarios` endpoint returns 404 (not available in v1)
- Numbered filenames (1-, 2-, 3-...) stability is UNVERIFIED

This blocked true bidirectional sync between GitHub and AssertThat.

---

## Solution Discovered

### AssertThat V2 API Provides Scenario IDs

Found in `project/AssertThat/assertthat-bdd.postman_collection.json`:

```
GET /rest/api/2/project/{projectId}/report/scenarios?page=0&size=10
```

This V2 endpoint returns scenario data with IDs, solving the blocker.

### Additional V2 Endpoints Available

```
GET /rest/api/2/project/{projectId}/report/scenarios/deleted?page=0&size=10
```

This can help track deleted scenarios for proper sync handling.

---

## Implementation Plan

### Phase 1: V2 API Integration (2-3 hours)

#### 1.1 Add V2 API Methods to AssertThatApiClient

**File:** `scripts/api/AssertThatApiClient.mjs`

Add new methods:

```javascript
/**
 * Get scenarios from AssertThat using V2 API
 * 
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (default: 0)
 * @param {number} options.size - Page size (default: 100)
 * @returns {Promise<Object>} Scenarios data with IDs
 */
async getScenarios(options = {}) {
  const page = options.page || 0;
  const size = options.size || 100;
  
  const path = `/rest/api/2/project/${this.projectId}/report/scenarios?page=${page}&size=${size}`;
  
  return this.makeRequest({
    method: 'GET',
    path,
    expectBinary: false,
  });
}

/**
 * Get all scenarios with pagination
 * 
 * @returns {Promise<Array>} All scenarios
 */
async getAllScenarios() {
  const allScenarios = [];
  let page = 0;
  let hasMore = true;
  
  while (hasMore) {
    const response = await this.getScenarios({ page, size: 100 });
    
    // Response format TBD - will document after first API call
    const scenarios = response.content || response.scenarios || [];
    allScenarios.push(...scenarios);
    
    hasMore = !response.last && scenarios.length > 0;
    page++;
  }
  
  return allScenarios;
}

/**
 * Get deleted scenarios from AssertThat using V2 API
 * 
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Deleted scenarios data
 */
async getDeletedScenarios(options = {}) {
  const page = options.page || 0;
  const size = options.size || 100;
  
  const path = `/rest/api/2/project/${this.projectId}/report/scenarios/deleted?page=${page}&size=${size}`;
  
  return this.makeRequest({
    method: 'GET',
    path,
    expectBinary: false,
  });
}
```

#### 1.2 Test V2 API Response

Create test script: `scripts/test-v2-api.mjs`

```javascript
#!/usr/bin/env node

import dotenv from 'dotenv';
import { AssertThatApiClient } from './api/AssertThatApiClient.mjs';
import { SyncConfiguration } from './config/SyncConfiguration.mjs';

dotenv.config();

async function testV2Api() {
  console.log('Testing AssertThat V2 API...\n');
  
  const config = new SyncConfiguration();
  const apiClient = new AssertThatApiClient({
    projectId: config.assertThat.projectId,
    accessKey: config.assertThat.accessKey,
    secretKey: config.assertThat.secretKey,
  });
  
  // Test scenarios endpoint
  console.log('Fetching scenarios (page 0, size 10)...');
  const response = await apiClient.getScenarios({ page: 0, size: 10 });
  
  console.log('\nResponse structure:');
  console.log(JSON.stringify(response, null, 2));
  
  // Test all scenarios
  console.log('\n\nFetching all scenarios...');
  const allScenarios = await apiClient.getAllScenarios();
  
  console.log(`\nTotal scenarios: ${allScenarios.length}`);
  
  if (allScenarios.length > 0) {
    console.log('\nFirst scenario:');
    console.log(JSON.stringify(allScenarios[0], null, 2));
  }
}

testV2Api().catch(console.error);
```

#### 1.3 Update FeatureMetadataManager

**File:** `scripts/metadata/FeatureMetadataManager.mjs`

Update `extractFromApiResponse()` method to handle V2 format:

```javascript
/**
 * Extract metadata from AssertThat V2 API response
 * 
 * @param {Object} apiResponse - V2 API response
 * @returns {Map<string, Object>} Map of feature name to metadata
 */
extractFromApiResponse(apiResponse) {
  const metadataByFeature = new Map();
  
  // V2 API format (to be confirmed by testing)
  const scenarios = apiResponse.content || apiResponse.scenarios || [];
  
  for (const scenario of scenarios) {
    const featureName = scenario.feature || scenario.featureName;
    const scenarioName = scenario.name || scenario.scenarioName;
    const scenarioId = scenario.id;
    
    if (!metadataByFeature.has(featureName)) {
      metadataByFeature.set(featureName, {
        featureId: featureName, // V2 API may not have feature IDs
        scenarioIds: new Map(),
      });
    }
    
    const metadata = metadataByFeature.get(featureName);
    metadata.scenarioIds.set(scenarioName, scenarioId);
  }
  
  return metadataByFeature;
}
```

---

### Phase 2: Verify Numbered Filename Stability (1 hour)

Create test script: `scripts/test-filename-stability.mjs`

This script will guide the user through manual testing:

1. **Rename Test**
   - Prompt: "Rename feature '1-virtual-task-handling...' in AssertThat"
   - Download features
   - Check if filename still starts with '1-'

2. **Delete Test**
   - Prompt: "Delete feature '5-column-management...' in AssertThat"
   - Download features
   - Check if features 6-13 renumber to 5-12

3. **Add Test**
   - Prompt: "Create new feature in AssertThat"
   - Download features
   - Check what number the new feature gets

4. **Reorder Test**
   - Prompt: "Reorder features in AssertThat (if possible)"
   - Download features
   - Check if numbers change

---

### Phase 3: ID Assignment Workflow (3-4 hours)

#### 3.1 Create ID Assignment Script

**File:** `scripts/workflows/assign-ids-workflow.mjs`

```javascript
#!/usr/bin/env node

/**
 * Complete ID Assignment Workflow
 * 
 * 1. Upload all GitHub features to AssertThat
 * 2. Fetch scenarios with IDs from V2 API
 * 3. Update GitHub feature files with IDs
 * 4. Show diff for review
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { AssertThatApiClient } from '../api/AssertThatApiClient.mjs';
import { FeatureMetadataManager } from '../metadata/FeatureMetadataManager.mjs';
import { SyncConfiguration } from '../config/SyncConfiguration.mjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const featuresDir = path.join(rootDir, 'features');

async function assignIds() {
  console.log('🔑 AssertThat ID Assignment Workflow\n');
  
  // Initialize
  const config = new SyncConfiguration();
  const apiClient = new AssertThatApiClient({
    projectId: config.assertThat.projectId,
    accessKey: config.assertThat.accessKey,
    secretKey: config.assertThat.secretKey,
  });
  const metadataManager = new FeatureMetadataManager();
  
  // Step 1: Upload features
  console.log('📤 Step 1: Uploading features to AssertThat...\n');
  const features = await loadFeatureFiles(featuresDir);
  await uploadFeatures(apiClient, features);
  
  // Step 2: Fetch scenarios with IDs
  console.log('\n📥 Step 2: Fetching scenarios with IDs from V2 API...\n');
  const scenarios = await apiClient.getAllScenarios();
  console.log(`   Found ${scenarios.length} scenarios with IDs\n`);
  
  // Step 3: Extract metadata
  console.log('🔍 Step 3: Extracting metadata...\n');
  const metadataByFeature = metadataManager.extractFromApiResponse({ scenarios });
  
  // Step 4: Update feature files
  console.log('✏️  Step 4: Updating feature files with IDs...\n');
  await updateFeatureFiles(featuresDir, metadataByFeature, metadataManager);
  
  console.log('\n✅ ID assignment complete!');
  console.log('\n📝 Next steps:');
  console.log('   1. Review changes: git diff features/');
  console.log('   2. Commit: git add features/ && git commit -m "OG-26 feat: Add AssertThat IDs to feature files"');
}

assignIds().catch(console.error);
```

---

## Testing Strategy

### Unit Tests

Add tests for new V2 API methods:

**File:** `test/unit/assertthat-api-client-v2.test.ts`

```typescript
describe('AssertThatApiClient V2 API', () => {
  describe('getScenarios', () => {
    it('should fetch scenarios with pagination');
    it('should handle empty response');
    it('should include scenario IDs in response');
  });
  
  describe('getAllScenarios', () => {
    it('should fetch all scenarios across multiple pages');
    it('should stop when no more pages');
  });
  
  describe('getDeletedScenarios', () => {
    it('should fetch deleted scenarios');
  });
});
```

### Integration Tests

Test complete workflow:

1. Upload features
2. Fetch scenarios with IDs
3. Update feature files
4. Verify IDs are present in files

---

## Success Criteria

- [ ] V2 API methods implemented and tested
- [ ] API response format documented
- [ ] FeatureMetadataManager updated for V2 compatibility
- [ ] Filename stability tests completed
- [ ] ID assignment workflow implemented
- [ ] All feature files have AssertThat IDs
- [ ] Bidirectional sync works with ID-based matching
- [ ] Unit tests passing (target: 100%)
- [ ] Integration tests passing

---

## Timeline

- **Phase 1**: 2-3 hours (V2 API integration)
- **Phase 2**: 1 hour (stability tests)
- **Phase 3**: 3-4 hours (ID assignment workflow)
- **Total**: 6-8 hours

---

## Next Immediate Actions

1. ✅ Document solution (this file)
2. ⏳ Implement V2 API methods in AssertThatApiClient
3. ⏳ Test V2 API and document response format
4. ⏳ Update FeatureMetadataManager for V2
5. ⏳ Run filename stability tests
6. ⏳ Implement ID assignment workflow
7. ⏳ Update sync logic to use IDs
8. ⏳ Test bidirectional sync

---

## References

- **Postman Collection**: `project/AssertThat/assertthat-bdd.postman_collection.json`
- **API Client**: `scripts/api/AssertThatApiClient.mjs`
- **Metadata Manager**: `scripts/metadata/FeatureMetadataManager.mjs`
- **OG-47 Blocker**: Jira comment 10165
- **Original Requirements**: OG-26 comment 10066

