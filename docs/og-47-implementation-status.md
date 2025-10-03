# OG-47 Implementation Status

**Date:** 2025-10-03  
**Branch:** OG-8-bdd-testing-framework-cont-2  
**Status:** Phase 1 Complete - V2 API Integration

---

## Summary

Successfully identified and implemented solution for the critical blocker discovered in OG-47 comment 10165. The AssertThat V1 API did not expose scenario IDs, but the V2 API provides this functionality through the scenarios report endpoint.

---

## Problem Identified (from Comment 10165)

### Critical Blocker
- AssertThat V1 API does NOT expose scenario IDs
- Downloaded feature files do NOT contain IDs
- `/scenarios` endpoint returns 404 (not available in V1)
- Numbered filenames (1-, 2-, 3-...) stability was UNVERIFIED
- This blocked true bidirectional sync between GitHub and AssertThat

### Impact
- Cannot reliably match GitHub files to AssertThat scenarios
- Cannot detect renames, moves, or deletions
- Cannot implement intelligent conflict resolution
- Sync would be "blind" - just overwriting files

---

## Solution Discovered

### AssertThat V2 API Endpoints

Found in `project/AssertThat/assertthat-bdd.postman_collection.json`:

1. **Get Scenarios with IDs**
   ```
   GET /rest/api/2/project/{projectId}/report/scenarios?page=0&size=10
   ```

2. **Get Deleted Scenarios**
   ```
   GET /rest/api/2/project/{projectId}/report/scenarios/deleted?page=0&size=10
   ```

These endpoints provide the scenario IDs needed for reliable sync.

---

## Phase 1: V2 API Integration (COMPLETE)

### Implemented Features

#### 1. V2 API Methods in AssertThatApiClient

**File:** `scripts/api/AssertThatApiClient.mjs`

Added three new methods:

```javascript
// Fetch scenarios with pagination
async getScenarios(options = {})

// Fetch all scenarios (handles pagination automatically)
async getAllScenarios()

// Fetch deleted scenarios
async getDeletedScenarios(options = {})
```

**Features:**
- Automatic pagination handling
- Safety limit (100 pages max) to prevent infinite loops
- Flexible response format handling (content/scenarios/data)
- Consistent error handling with retry logic

#### 2. Test Script for V2 API

**File:** `scripts/test-v2-api.mjs`

Comprehensive test script that:
- Verifies V2 API is accessible
- Documents actual response format
- Confirms scenario IDs are available
- Analyzes response structure
- Groups scenarios by feature
- Tests deleted scenarios endpoint
- Provides troubleshooting guidance

**Usage:**
```bash
npm run test:v2-api
```

#### 3. Documentation

**File:** `docs/og-47-v2-api-solution.md`

Complete implementation plan covering:
- Problem summary
- Solution details
- Phase 1: V2 API Integration
- Phase 2: Filename Stability Tests
- Phase 3: ID Assignment Workflow
- Testing strategy
- Success criteria
- Timeline estimates

### Commit

```
d3fd359 - OG-47 feat: Implement AssertThat V2 API for scenario ID retrieval
```

---

## Next Steps

### Phase 2: Test V2 API Response Format (1 hour)

**Objective:** Verify API works and document actual response format

**Tasks:**
1. Run test script: `npm run test:v2-api`
2. Document response structure
3. Verify scenario IDs are present and stable
4. Update FeatureMetadataManager if needed

**Expected Output:**
- Response format documented
- Scenario ID field identified
- Feature name field identified
- Pagination behavior confirmed

### Phase 3: Verify Numbered Filename Stability (1 hour)

**Objective:** Determine if numbered filenames (1-, 2-, 3-...) are stable identifiers

**Tests to Perform:**

1. **Rename Test**
   - In AssertThat: Rename "1-virtual-task-handling..." to "1-new-name..."
   - Download features
   - Check: Does it keep number "1-"?

2. **Delete Test**
   - In AssertThat: Delete "5-column-management..."
   - Download features
   - Check: Do features 6-13 renumber to 5-12?

3. **Add Test**
   - In AssertThat: Create new feature
   - Download features
   - Check: What number does it get? (14? or fills gap?)

4. **Reorder Test**
   - In AssertThat: Reorder features (if possible)
   - Download features
   - Check: Do numbers change with order?

**Decision Point:**
- If numbers are stable → Use as secondary identifier
- If numbers are NOT stable → Rely solely on scenario IDs

### Phase 4: Update FeatureMetadataManager (1-2 hours)

**Objective:** Update metadata manager to work with V2 API response

**File:** `scripts/metadata/FeatureMetadataManager.mjs`

**Tasks:**
1. Update `extractFromApiResponse()` for V2 format
2. Handle scenario ID extraction
3. Handle feature name extraction
4. Add tests for V2 response parsing
5. Verify all 13 existing tests still pass

### Phase 5: Implement ID Assignment Workflow (2-3 hours)

**Objective:** Create workflow to assign AssertThat IDs to GitHub feature files

**New Script:** `scripts/workflows/assign-ids-workflow.mjs`

**Workflow Steps:**
1. Upload all GitHub features to AssertThat
2. Fetch scenarios with IDs from V2 API
3. Extract metadata using FeatureMetadataManager
4. Update GitHub feature files with IDs
5. Show diff for review
6. Commit changes

**Usage:**
```bash
node scripts/workflows/assign-ids-workflow.mjs
```

### Phase 6: Update Sync Logic (2-3 hours)

**Objective:** Modify sync to use ID-based matching instead of filename matching

**File:** `scripts/sync-features.mjs`

**Changes:**
1. Use `FeatureMetadataManager.createScenarioMapping()`
2. Match by scenario ID instead of filename
3. Handle new scenarios (no GitHub match)
4. Handle deleted scenarios (no AssertThat match)
5. Handle renamed scenarios (same ID, different name)

### Phase 7: Test Bidirectional Sync (1-2 hours)

**Objective:** Verify complete sync workflow works

**Test Scenarios:**
1. Make changes in GitHub → Sync to AssertThat
2. Make changes in AssertThat → Sync to GitHub
3. Rename scenario in AssertThat → Verify GitHub updates
4. Delete scenario in AssertThat → Verify GitHub handles it
5. Add scenario in AssertThat → Verify GitHub adds it
6. Conflict scenario → Verify resolution works

---

## Timeline

| Phase | Description | Estimated Time | Status |
|-------|-------------|----------------|--------|
| 1 | V2 API Integration | 2-3 hours | ✅ COMPLETE |
| 2 | Test V2 API | 1 hour | ⏳ NEXT |
| 3 | Filename Stability | 1 hour | ⏳ PENDING |
| 4 | Update Metadata Manager | 1-2 hours | ⏳ PENDING |
| 5 | ID Assignment Workflow | 2-3 hours | ⏳ PENDING |
| 6 | Update Sync Logic | 2-3 hours | ⏳ PENDING |
| 7 | Test Bidirectional Sync | 1-2 hours | ⏳ PENDING |
| **Total** | | **10-16 hours** | **~20% Complete** |

---

## Success Criteria

### Phase 1 (Complete)
- [x] V2 API methods implemented
- [x] Test script created
- [x] Documentation written
- [x] Code committed

### Overall (Pending)
- [ ] V2 API response format documented
- [ ] Filename stability verified
- [ ] FeatureMetadataManager updated for V2
- [ ] All feature files have AssertThat IDs
- [ ] Sync uses ID-based matching
- [ ] Bidirectional sync works correctly
- [ ] All tests passing

---

## Technical Decisions

### 1. Use V2 API for Scenario IDs
**Decision:** Use V2 scenarios report endpoint instead of V1 download endpoint  
**Rationale:** V2 provides scenario IDs which are essential for reliable sync  
**Impact:** Enables true bidirectional sync with intelligent conflict resolution

### 2. Automatic Pagination
**Decision:** Implement `getAllScenarios()` with automatic pagination  
**Rationale:** Simplifies client code and ensures all scenarios are fetched  
**Impact:** More robust, less error-prone sync operations

### 3. Safety Limits
**Decision:** Add 100-page pagination limit  
**Rationale:** Prevent infinite loops in case of API issues  
**Impact:** Fail-safe behavior, clear error messages

### 4. Flexible Response Handling
**Decision:** Support multiple response formats (content/scenarios/data)  
**Rationale:** API format may vary or change  
**Impact:** More resilient to API changes

---

## Risks and Mitigations

### Risk 1: V2 API Response Format Unknown
**Mitigation:** Created test script to document actual format before proceeding

### Risk 2: Numbered Filenames May Not Be Stable
**Mitigation:** Dedicated testing phase to verify stability

### Risk 3: Scenario IDs May Not Be Unique
**Mitigation:** Test script verifies ID uniqueness

### Risk 4: API Rate Limiting
**Mitigation:** Existing retry logic with exponential backoff

---

## References

- **Blocker Issue:** OG-47 comment 10165
- **Original Requirements:** OG-26 comment 10066
- **Postman Collection:** `project/AssertThat/assertthat-bdd.postman_collection.json`
- **API Client:** `scripts/api/AssertThatApiClient.mjs`
- **Metadata Manager:** `scripts/metadata/FeatureMetadataManager.mjs`
- **Solution Doc:** `docs/og-47-v2-api-solution.md`

---

## Immediate Next Action

**Run V2 API Test:**
```bash
npm run test:v2-api
```

This will verify the API works and document the response format, enabling us to proceed with Phase 4 (updating FeatureMetadataManager).

