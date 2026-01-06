# OG-47 Phase 7: Bidirectional Sync Test Plan

**Date:** 2025-10-03  
**Branch:** OG-8-bdd-testing-framework-cont-2  
**Status:** Phase 6 Complete - Ready for Phase 7 Testing

---

## Overview

Phase 7 involves comprehensive testing of the ID-based bidirectional sync to ensure it handles all scenarios correctly.

---

## Test Scenarios

### ✅ Test 1: Baseline - All Scenarios In Sync

**Status:** PASSED ✅

**Test:**
```bash
npm run sync:assertthat
```

**Expected Result:**
- All 135 scenarios should be in sync
- No new, deleted, or renamed scenarios

**Actual Result:**
```
📊 Sync Statistics:
   ✅ In sync: 135
   🆕 New in AssertThat: 0
   🗑️  Deleted in AssertThat: 0
   ✏️  Renamed in AssertThat: 0

✅ All scenarios are in sync - no changes needed!
```

**Conclusion:** ✅ PASSED - Baseline sync working correctly

---

### Test 2: Detect New Scenario in AssertThat

**Status:** PENDING ⏳

**Setup:**
1. Go to AssertThat web interface
2. Add a new scenario to an existing feature
3. Note the feature name and scenario name

**Test:**
```bash
npm run sync:assertthat
```

**Expected Result:**
- Should detect 1 new scenario in AssertThat
- Should display: `🆕 New in AssertThat: 1`
- Should show feature name and scenario name

**Verification:**
- [ ] New scenario detected
- [ ] Correct feature name displayed
- [ ] Correct scenario name displayed
- [ ] Scenario ID available

**Cleanup:**
- Delete the test scenario in AssertThat OR
- Keep it and update GitHub to include it

---

### Test 3: Detect Renamed Scenario in AssertThat

**Status:** PENDING ⏳

**Setup:**
1. Go to AssertThat web interface
2. Rename an existing scenario (e.g., in "BDD Framework Validation")
3. Note the old name and new name

**Test:**
```bash
npm run sync:assertthat
```

**Expected Result:**
- Should detect 1 renamed scenario
- Should display: `✏️  Renamed in AssertThat: 1`
- Should show: `"Old Name" → "New Name" (Feature Name)`

**Verification:**
- [ ] Renamed scenario detected
- [ ] Old name matches GitHub
- [ ] New name matches AssertThat
- [ ] Same scenario ID
- [ ] Correct feature name

**Cleanup:**
- Rename back to original OR
- Update GitHub file with new name

---

### Test 4: Detect Deleted Scenario in AssertThat

**Status:** PENDING ⏳

**Setup:**
1. Go to AssertThat web interface
2. Delete a scenario (choose a non-critical one)
3. Note the scenario name and ID from GitHub file

**Test:**
```bash
npm run sync:assertthat
```

**Expected Result:**
- Should detect 1 deleted scenario
- Should display: `🗑️  Deleted in AssertThat: 1`
- Should show scenario name and ID

**Verification:**
- [ ] Deleted scenario detected
- [ ] Correct scenario name displayed
- [ ] Correct scenario ID displayed
- [ ] Scenario still exists in GitHub

**Cleanup:**
- Restore the scenario in AssertThat OR
- Remove from GitHub file

---

### Test 5: Multiple Changes Simultaneously

**Status:** PENDING ⏳

**Setup:**
1. Add 1 new scenario in AssertThat
2. Rename 1 existing scenario in AssertThat
3. Delete 1 scenario in AssertThat

**Test:**
```bash
npm run sync:assertthat
```

**Expected Result:**
- Should detect all 3 changes
- Should display:
  - `🆕 New in AssertThat: 1`
  - `✏️  Renamed in AssertThat: 1`
  - `🗑️  Deleted in AssertThat: 1`
- Should list details for each change

**Verification:**
- [ ] All changes detected
- [ ] Correct counts for each type
- [ ] Details displayed for each change
- [ ] No false positives

**Cleanup:**
- Revert all changes OR
- Update GitHub to match

---

### Test 6: GitHub → AssertThat Sync (Upload)

**Status:** PENDING ⏳

**Setup:**
1. Modify a scenario in a GitHub feature file
2. Change the scenario name or steps
3. Keep the @assertthat-scenario-id comment

**Test:**
```bash
npm run assign:ids
```

**Expected Result:**
- Should upload the modified feature to AssertThat
- AssertThat should reflect the changes
- Scenario ID should remain the same

**Verification:**
- [ ] Feature uploaded successfully
- [ ] Changes visible in AssertThat
- [ ] Scenario ID unchanged
- [ ] No duplicate scenarios created

**Cleanup:**
- Verify changes are correct
- Run sync to confirm in sync

---

### Test 7: Conflict Detection

**Status:** PENDING ⏳

**Setup:**
1. Modify a scenario in GitHub (change steps)
2. Modify the SAME scenario in AssertThat (change name)
3. Do NOT sync yet

**Test:**
```bash
npm run sync:assertthat
```

**Expected Result:**
- Should detect the rename in AssertThat
- Should show: `✏️  Renamed in AssertThat: 1`
- Note: Current implementation doesn't detect content changes, only renames

**Verification:**
- [ ] Rename detected
- [ ] Sync status shows changes needed
- [ ] No data loss

**Cleanup:**
- Decide which version to keep
- Update accordingly

---

### Test 8: Feature-Level Changes

**Status:** PENDING ⏳

**Setup:**
1. Add a completely new feature in AssertThat
2. Add 2-3 scenarios to it

**Test:**
```bash
npm run sync:assertthat
```

**Expected Result:**
- Should detect 2-3 new scenarios
- All should belong to the new feature
- Should display feature name for each

**Verification:**
- [ ] All new scenarios detected
- [ ] Correct feature name for each
- [ ] Scenario IDs available

**Cleanup:**
- Download the new feature OR
- Delete from AssertThat

---

### Test 9: ID Persistence After Rename

**Status:** PENDING ⏳

**Setup:**
1. Note a scenario's ID from GitHub file
2. Rename that scenario in AssertThat
3. Run sync

**Test:**
```bash
npm run sync:assertthat
```

**Expected Result:**
- Should detect rename
- Should show same ID for renamed scenario
- ID should match the one noted in step 1

**Verification:**
- [ ] Rename detected
- [ ] ID matches original
- [ ] ID-based matching working correctly

**Cleanup:**
- Update GitHub with new name OR
- Rename back in AssertThat

---

### Test 10: Large-Scale Sync

**Status:** PENDING ⏳

**Setup:**
- Current state: 135 scenarios across 13 features
- All in sync

**Test:**
```bash
npm run sync:assertthat
```

**Expected Result:**
- Should complete in < 10 seconds
- Should handle all 135 scenarios
- Should report all in sync

**Verification:**
- [ ] Performance acceptable (< 10s)
- [ ] All scenarios processed
- [ ] No errors or timeouts
- [ ] Memory usage reasonable

**Cleanup:**
- None needed

---

## Test Execution Checklist

### Prerequisites
- [ ] All feature files have @assertthat-scenario-id comments
- [ ] AssertThat credentials configured in .env
- [ ] Git working directory is clean
- [ ] On branch: OG-8-bdd-testing-framework-cont-2

### Execution Order
1. [ ] Test 1: Baseline (PASSED ✅)
2. [ ] Test 2: New scenario
3. [ ] Test 3: Renamed scenario
4. [ ] Test 4: Deleted scenario
5. [ ] Test 5: Multiple changes
6. [ ] Test 6: GitHub → AssertThat
7. [ ] Test 7: Conflict detection
8. [ ] Test 8: Feature-level changes
9. [ ] Test 9: ID persistence
10. [ ] Test 10: Large-scale sync

### Post-Test Verification
- [ ] All tests documented with results
- [ ] Any issues identified and logged
- [ ] GitHub and AssertThat back in sync
- [ ] No orphaned scenarios
- [ ] No duplicate IDs

---

## Success Criteria

### Phase 7 Complete When:
- [x] Test 1 (Baseline) passes
- [ ] At least 5 additional tests pass
- [ ] No critical issues found
- [ ] Sync logic handles all scenarios correctly
- [ ] Documentation updated with test results

### Known Limitations
1. **Content Change Detection:** Current implementation only detects renames, not content changes (steps, tags, etc.)
2. **One-Way Sync:** Currently analyzes AssertThat → GitHub direction only
3. **Manual Resolution:** Conflicts require manual resolution (no auto-merge yet)

### Future Enhancements
1. Implement content change detection (compare steps, tags)
2. Implement GitHub → AssertThat sync direction
3. Add auto-merge for non-conflicting changes
4. Add staging area for conflict resolution
5. Integrate with PR workflow for automated sync

---

## Test Results Summary

| Test | Status | Date | Notes |
|------|--------|------|-------|
| 1. Baseline | ✅ PASSED | 2025-10-03 | All 135 scenarios in sync |
| 2. New scenario | ⏳ PENDING | - | - |
| 3. Renamed scenario | ⏳ PENDING | - | - |
| 4. Deleted scenario | ⏳ PENDING | - | - |
| 5. Multiple changes | ⏳ PENDING | - | - |
| 6. GitHub → AssertThat | ⏳ PENDING | - | - |
| 7. Conflict detection | ⏳ PENDING | - | - |
| 8. Feature-level | ⏳ PENDING | - | - |
| 9. ID persistence | ⏳ PENDING | - | - |
| 10. Large-scale | ⏳ PENDING | - | - |

---

## Next Steps

1. **Execute Tests 2-10** - Run each test scenario and document results
2. **Fix Any Issues** - Address any bugs or edge cases discovered
3. **Update Documentation** - Document test results and any changes made
4. **Commit Progress** - Commit test results and any fixes
5. **Update Jira** - Update OG-47 with Phase 7 completion status

---

**Current Status:** Phase 6 Complete ✅ | Phase 7 Test 1 Complete ✅ | Tests 2-10 Pending ⏳

