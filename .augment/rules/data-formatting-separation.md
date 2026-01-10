---
type: "agent_requested"
description: "Guidelines for data formatting and localization in the Gantt plugin"
---

# Data Formatting and Localization

## Core Principle: Separation of Concerns

**Data adapters extract raw data. Views format for display.**

This follows the Single Responsibility Principle and aligns with our modular architecture guidelines.

## Architecture Pattern

```
Data Layer (BasesDataAdapter)
├─ Returns: Raw native JavaScript values
│  ├─ Dates → Date objects or null
│  ├─ Numbers → raw numbers or null
│  ├─ Strings → raw strings
│  └─ Paths → file paths (strings)
├─ Role: Data extraction and type conversion only
└─ NO formatting, NO localization, NO display logic

Presentation Layer (Views: GanttTaskListView, etc.)
├─ Receives: Raw data from adapter
├─ Role: Format data for user display
├─ Handles:
│  ├─ Date formatting (YYYY-MM-DD, locale-specific, etc.)
│  ├─ Number formatting (decimals, thousands separators, units)
│  ├─ Text localization (i18n)
│  └─ Display-specific transformations
└─ Examples: formatDate(), formatProgress(), formatDuration()
```

## TaskNotes Reference Implementation

### Data Adapter (BasesDataAdapter.ts)
```typescript
// ✅ CORRECT - Returns raw Date object as ISO string
private convertValueToNative(value: any): any {
  if (value.date instanceof Date) {
    return value.date.toISOString();  // Raw ISO string
  }
  // ... other type conversions
}

// ❌ EXCEPTION - Only for group headers in UI
convertGroupKeyToString(key: any): string {
  if (actualValue instanceof Date) {
    // Format as YYYY-MM-DD for group header display
    return `${year}-${month}-${day}`;
  }
}
```

### View Layer (TaskListView.ts, CalendarView.ts, etc.)
```typescript
import { format } from "date-fns";

// ✅ CORRECT - Formatting happens in view
private renderTask(task: TaskInfo) {
  const formattedDate = format(new Date(task.due), "yyyy-MM-dd");
  // ... render with formatted date
}
```

## Implementation in Gantt Plugin

### Current Implementation (Correct ✅)

**BasesDataAdapter.ts**
```typescript
// ✅ Returns raw Date object
extractDate(entry: BasesEntry, dateProperty: BasesPropertyId): Date | null {
  const value = this.extractValue(entry, dateProperty);
  return this.convertToDate(value);  // Returns Date or null
}

// ✅ Returns raw number
extractProgress(entry: BasesEntry, progressProperty: BasesPropertyId): number | null {
  const value = this.extractValue(entry, progressProperty);
  return this.convertToNumber(value, { min: 0, max: 100 });  // Returns number or null
}
```

**GanttTaskListView.ts**
```typescript
// ✅ Formatting in presentation layer
private formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ✅ Used during rendering
if (task.start || task.end) {
  const startStr = task.start ? this.formatDate(task.start) : '---';
  const endStr = task.end ? this.formatDate(task.end) : '---';
  text += ` [${startStr} → ${endStr}]`;
}
```

## Benefits of This Approach

### 1. Single Responsibility
- Data adapter: Extract and convert types
- Views: Format and display

### 2. Reusability
- Same raw data can be formatted differently in different contexts
- Example: Gantt chart might show "Jan 15", TaskList shows "2024-01-15"

### 3. Testability
- Test data extraction independently from formatting
- Test formatting independently from data extraction
- Mock raw data easily in view tests

### 4. Localization Ready
- All formatting logic centralized in views
- Easy to add locale-specific formatting later
- Example: `format(date, "yyyy-MM-dd", { locale: userLocale })`

### 5. Performance
- Data adapter runs once per data load
- Views can cache formatted strings if needed
- Different views can choose appropriate precision

## Anti-Patterns to Avoid

### ❌ DON'T: Format in Data Adapter
```typescript
// ❌ BAD - Formatting in data layer
extractDate(entry: BasesEntry, dateProperty: BasesPropertyId): string {
  const date = this.convertToDate(value);
  return date ? `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}` : '';
}
```

**Why wrong:**
- Locks all views to one format
- Can't reuse date object for calculations
- Hard to localize later

### ❌ DON'T: Return Formatted Strings
```typescript
// ❌ BAD - Returns display string instead of raw value
extractProgress(entry: BasesEntry, progressProperty: BasesPropertyId): string {
  const value = this.convertToNumber(value);
  return value !== null ? `${value}%` : 'N/A';
}
```

**Why wrong:**
- Views need raw numbers for calculations, sorting, styling
- Can't use for progress bars, animations, comparisons
- Mixes data and presentation

## When Formatting IS Acceptable in Data Layer

**Only for UI-specific group headers** (following TaskNotes pattern):

```typescript
// ✅ ACCEPTABLE - Only for group key display
convertGroupKeyToString(key: any): string {
  if (actualValue instanceof Date) {
    return `${year}-${month}-${day}`;
  }
  // ... other group key formatting
}
```

**Why acceptable:**
- Method name clearly indicates UI purpose ("...ToString")
- Only used for group headers, not data extraction
- Original raw data still available via other methods

## Checklist for New Data Extraction Methods

When adding new extraction methods to BasesDataAdapter:

- [ ] Returns raw JavaScript types (Date, number, string, boolean)
- [ ] Returns `null` for missing/invalid values (not empty strings or formatted text)
- [ ] No formatting logic (no date formatting, no units like "%", no localization)
- [ ] No display-specific transformations
- [ ] JSDoc clearly documents the return type
- [ ] Views handle all formatting for display

## Related Guidelines

- See [architecture.md](./architecture.md) for modular design principles
- See [typescript.md](./typescript.md) for type safety guidelines
- See [code-quality.md](./code-quality.md) for single responsibility principle
