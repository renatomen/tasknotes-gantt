# TaskNotes Implementation Learnings - Parent/Child Relationships

**Document Purpose**: Comprehensive reference for implementing parent-child hierarchies in Obsidian Gantt, based on analysis of the TaskNotes plugin.

**Source**: https://github.com/callumalpass/tasknotes
**Related Ticket**: OG-87 - Minimum Required Fields Mapping
**Date**: 2026-01-10

---

## Architecture Overview

TaskNotes uses a **dependency-based relationship model** rather than simple parent-child hierarchies.

### Task Structure (from types.ts)

```typescript
export interface TaskInfo {
  id?: string;
  title: string;
  status: string;
  priority: string;
  due?: string;
  scheduled?: string;
  path: string;
  archived: boolean;
  tags?: string[];
  contexts?: string[];
  projects?: string[];
  // Relationship fields:
  blockedBy?: TaskDependency[];  // Array of dependencies
  blocking?: string[];           // Array of task paths
  isBlocked?: boolean;
  isBlocking?: boolean;
}

export interface TaskDependency {
  uid: string;                    // Task identifier
  reltype: TaskDependencyRelType; // Relationship type
  gap?: string;                   // Time gap between tasks
}

export type TaskDependencyRelType =
  | "FINISHTOSTART"
  | "FINISHTOFINISH"
  | "STARTTOSTART"
  | "STARTTOFINISH";
```

**Key Insight**: Tasks support **multiple dependencies** through arrays, not single parent references.

---

## BasesDataAdapter.ts - Data Extraction Patterns

### Core Extraction Method
```typescript
extractDataItems() // Returns BasesDataItem[] from basesView.data.data
```

### Property Handling
- **Frontmatter extraction**: `extractEntryProperties()` - cheap operations only
- **Lazy loading**: `getComputedProperty()` - call during rendering for visible items only
- **Array handling**: `convertValueToNative()` processes ListValue via `.at(i)` iteration
- **File references**: FileValue objects extract paths via `value.file.path`

**Performance Pattern**:
> "Computed file properties (backlinks, links, etc.) are fetched lazily. Call during rendering for visible items only (20-50 items) - NOT during bulk extraction"

### Array Property Handling Pattern
```typescript
// ListValue iteration pattern from TaskNotes
if (value.type === 'ListValue') {
  const length = value.length;
  for (let i = 0; i < length; i++) {
    const item = value.at(i);
    // Process item - could be string, FileValue, etc.
  }
}
```

---

## PropertyMappingService.ts - Name Standardization

**Purpose**: Maps property names between three namespaces:
1. Bases Column IDs (e.g., `"note.complete_instances"`)
2. Frontmatter Property Names (e.g., `"complete_instances"`)
3. TaskCard Property IDs (used by extractors/renderers)

### Key Transformations
- Strips prefixes: `note.`, `task.`, `file.`
- Special mappings:
  - `timeEntries` → `totalTrackedTime` (for display)
  - `blockedBy` → `blocked` (shows status instead of array)

**What it DOESN'T handle**:
- Parent/child relationship logic
- Task duplication for multiple parents
- Dependency graph construction

---

## TaskListView.ts - Hierarchical Rendering

### Grouping System (NOT Parent-Child Duplication)

TaskListView uses a **two-level grouping system**:
- Primary headers (top-level groups)
- Sub-headers (nested groups when `subGroupPropertyId` configured)
- Task items beneath each level

### RenderItem Structure
```typescript
type RenderItem =
  | { type: 'primary-header' }
  | { type: 'sub-header' }
  | { type: 'task', groupKey?: string, subGroupKey?: string }
```

### Display Logic
```typescript
buildGroupedRenderItems() {
  // Creates flattened render structure
  // Tasks are FILTERED to groups, not DUPLICATED
  // "groupPaths mapped to taskNotes...skip groups with no matching tasks"
}

getPropertyValue() {
  // Retrieves SINGLE property value per task
  // Limits tasks to ONE classification path
}
```

**Critical Finding**: TaskNotes does **NOT** duplicate tasks for multiple parents. Tasks appear once, filtered into their group based on a single property value.

### Virtual Scrolling
- Activates at 100+ total items
- Optimizes rendering for large hierarchies

---

## Key Patterns for Gantt Implementation

### 1. Reference-Based Relationships
- Store relationships as **metadata references** (file paths, IDs)
- Keep **single source of truth** at data layer
- No data duplication at storage level

### 2. Lazy Property Loading
```typescript
// Good: Load expensive properties on-demand
getComputedProperty() // Call during rendering for visible items

// Bad: Load everything upfront
extractEntryProperties() // Only cheap operations
```

### 3. Array Property Handling
```typescript
// Pattern for extracting array-type properties
extractParents(entry: BasesEntry, parentProperty: string): string[] {
  const value = this.extractValue(entry, parentProperty);

  if (!value) return [];

  // Single value (string or FileValue)
  if (typeof value === 'string') {
    return [value];
  }

  // Array of values (ListValue in Bases API)
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item;
      if (item?.file?.path) return item.file.path; // FileValue
      return String(item);
    }).filter(Boolean);
  }

  return [];
}
```

### 4. Display-Layer Strategy
For multiple parents in Gantt:

**Option A: Filter/Group Tasks (TaskNotes approach)**
- Single task instance
- Filtered into one group at a time
- Change groupBy property to see different hierarchy
- **Limitation**: Task only appears under one parent at a time

**Option B: Virtual Duplication at Render Layer**
- Single task in data structure
- Render multiple instances in tree view
- Each instance shows under different parent
- Updates to any instance affect the single source task
- **Benefit**: Task appears under ALL parents simultaneously

---

## Important Distinctions

### What TaskNotes DOES:
- Dependency-based relationships (`blockedBy`, `blocking`)
- Grouping and filtering for hierarchical display
- Lazy loading for performance
- Reference-based relationships (no data duplication)
- Virtual scrolling for 100+ items

### What TaskNotes DOESN'T:
- Simple parent-child hierarchies
- Virtual task duplication for multiple parents
- Strict tree structures (uses flexible dependency graphs instead)
- Display task under multiple parents simultaneously

---

## Recommendations for Gantt Implementation

### Phase 1: Single Parent Support (Current Implementation)
1. Add `parentProperty` to field mappings
2. Extract parent reference (single file path or ID)
3. Set SVAR Gantt `parent` field
4. SVAR handles tree rendering natively

```typescript
// Field mappings interface
interface FieldMappings {
  textProperty: string;
  startProperty: string;
  endProperty: string;
  progressProperty: string;
  parentProperty?: string; // NEW
}

// Task with parent
interface SVARTask {
  id: string;
  text: string;
  start: Date;
  end: Date;
  progress?: number;
  parent?: string | number; // Single parent ID
  custom?: {
    obsidianPath: string;
    originalEntry: unknown;
    isUnscheduled: boolean;
  };
}
```

### Phase 2: Multiple Parents (Future Enhancement)

**If SVAR supports multiple parents natively:**
```typescript
interface SVARTask {
  parent?: string | string[]; // Support array
}
```

**If SVAR only supports single parent (Virtual Duplication):**

```typescript
// Single source of truth
{
  id: "task-1.md",
  text: "Implement feature",
  parents: ["project-a.md", "project-b.md"], // Store array
  custom: {
    originalEntry: BasesEntry,
    isVirtual: false,
    sourceTaskId: "task-1.md"
  }
}

// Generate virtual instances for rendering
[
  {
    id: "task-1.md#parent-project-a.md",
    text: "Implement feature",
    parent: "project-a.md", // Single parent
    custom: {
      sourceTaskId: "task-1.md",
      isVirtual: true,
      originalEntry: BasesEntry
    }
  },
  {
    id: "task-1.md#parent-project-b.md",
    text: "Implement feature",
    parent: "project-b.md", // Different parent
    custom: {
      sourceTaskId: "task-1.md",
      isVirtual: true,
      originalEntry: BasesEntry
    }
  }
]
```

**Virtual Duplication Implementation:**
```typescript
function createVirtualTasks(task: SVARTask, parents: string[]): SVARTask[] {
  if (parents.length <= 1) {
    // Single or no parent - return original task
    return [{ ...task, parent: parents[0] }];
  }

  // Multiple parents - create virtual instances
  return parents.map(parentId => ({
    ...task,
    id: `${task.id}#parent-${parentId}`,
    parent: parentId,
    custom: {
      ...task.custom,
      sourceTaskId: task.id,
      isVirtual: true
    }
  }));
}
```

### Performance Considerations
- Lazy load parent relationships during rendering
- Virtual scroll for 100+ tasks
- Cache parent lookups to avoid repeated property access
- Only render visible task instances
- Batch updates when syncing virtual instances back to source

### SVAR Gantt Library Capabilities
**Need to investigate:**
1. Does SVAR support `parent` field natively?
2. Does SVAR support multiple parents (array)?
3. How does SVAR handle tree indentation?
4. Can we customize parent-child rendering?

---

## Implementation Checklist

### Phase 1: Single Parent (Current)
- [ ] Add `parentProperty` to Bases view settings
- [ ] Update `FieldMappings` interface
- [ ] Write tests for `extractParents()` with single value
- [ ] Implement `extractParents()` in BasesDataAdapter
- [ ] Update PropertyMappingService to set `parent` field
- [ ] Verify hierarchical display in Gantt
- [ ] Test with real Bases data

### Phase 2: Multiple Parents (Future)
- [ ] Investigate SVAR multiple parent support
- [ ] Write tests for `extractParents()` with array values
- [ ] Implement virtual duplication if needed
- [ ] Add UI indication for tasks with multiple parents
- [ ] Implement sync mechanism for virtual instances
- [ ] Performance test with large datasets (100+ tasks)
- [ ] Add documentation for users

---

## Related Files

### Our Implementation
- `src/bases/services/BasesDataAdapter.ts` - Data extraction
- `src/bases/services/PropertyMappingService.ts` - Entry transformation
- `src/bases/types/field-mapping.ts` - Type definitions
- `src/bases/register.ts` - Bases view registration and options

### TaskNotes Reference
- `src/types.ts` - TaskInfo and TaskDependency interfaces
- `src/bases/BasesDataAdapter.ts` - Data extraction patterns
- `src/bases/PropertyMappingService.ts` - Property name mapping
- `src/bases/TaskListView.ts` - Hierarchical rendering

---

## Conclusion

**Key Takeaway**: TaskNotes uses grouping/filtering, not virtual duplication, for organizing tasks hierarchically. For Gantt charts with true parent-child trees, we need a different approach:

1. **Phase 1**: Implement single parent support using SVAR's native `parent` field
2. **Phase 2**: If multiple parents needed, implement virtual duplication at render layer
3. **Always**: Maintain single source of truth at data layer

This approach balances TaskNotes' performance patterns (lazy loading, reference-based relationships) with Gantt-specific requirements (true tree structures, multiple parent display).
