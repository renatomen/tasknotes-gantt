# Data Formatting and Localization

## Core Principle: Separation of Concerns

**Data adapters extract raw data. Views format for display.**

This follows the Single Responsibility Principle and aligns with the modular [architecture](./architecture.md).

## Architecture Pattern

```
Data Layer (BasesDataAdapter)
├─ Returns: Raw native JavaScript values
│  ├─ Dates → Date objects (or ISO strings) or null
│  ├─ Numbers → raw numbers or null
│  ├─ Strings → raw strings
│  └─ Paths → file paths (strings)
├─ Role: Data extraction and type conversion only
└─ NO formatting, NO localization, NO display logic

Presentation Layer (the Gantt view)
├─ Receives: Raw data from adapter
├─ Role: Format data for user display
├─ Handles:
│  ├─ Date formatting (YYYY-MM-DD, locale-specific, etc.)
│  ├─ Number formatting (decimals, separators, units)
│  ├─ Text localization (i18n)
│  └─ Display-specific transformations
└─ Examples: formatDate(), formatProgress(), formatDuration()
```

## Reference Implementation

### Data Adapter (`BasesDataAdapter.ts`)

```typescript
// ✅ Returns raw Date object
extractDate(entry: BasesEntry, dateProperty: BasesPropertyId): Date | null {
  const value = this.extractValue(entry, dateProperty);
  return this.convertToDate(value);  // Date or null
}

// ✅ Returns raw number
extractProgress(entry: BasesEntry, progressProperty: BasesPropertyId): number | null {
  const value = this.extractValue(entry, progressProperty);
  return this.convertToNumber(value, { min: 0, max: 100 });  // number or null
}
```

### View Layer (the Gantt view)

```typescript
// ✅ Formatting happens in the presentation layer
private formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

if (task.start || task.end) {
  const startStr = task.start ? this.formatDate(task.start) : '---';
  const endStr = task.end ? this.formatDate(task.end) : '---';
  text += ` [${startStr} → ${endStr}]`;
}
```

## Why

1. **Single responsibility** — adapter extracts/converts; views format/display.
2. **Reusability** — the same raw value renders differently per context (Gantt bar vs. grid cell).
3. **Testability** — extraction and formatting are tested independently; raw data is easy to mock.
4. **Localization-ready** — formatting is centralized in views (`format(date, "yyyy-MM-dd", { locale })`).
5. **Performance** — extraction runs once per load; views can cache formatted strings.

## Anti-Patterns

### ❌ Don't format in the data adapter

```typescript
// ❌ Locks every view to one format, can't reuse the Date for calculations
extractDate(entry: BasesEntry, dateProperty: BasesPropertyId): string {
  const date = this.convertToDate(value);
  return date ? `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}` : '';
}
```

### ❌ Don't return formatted strings

```typescript
// ❌ Views need raw numbers for bars, sorting, comparisons
extractProgress(entry: BasesEntry, progressProperty: BasesPropertyId): string {
  const value = this.convertToNumber(value);
  return value !== null ? `${value}%` : 'N/A';
}
```

## When Formatting IS Acceptable in the Data Layer

Only for **UI-specific group headers**, and only when the method name makes the UI purpose explicit:

```typescript
// ✅ Acceptable — name signals UI intent; raw data still available elsewhere
convertGroupKeyToString(key: any): string {
  if (actualValue instanceof Date) {
    return `${year}-${month}-${day}`;  // group-header display only
  }
}
```

## Checklist for New Data-Extraction Methods

- [ ] Returns raw JS types (`Date`, `number`, `string`, `boolean`)
- [ ] Returns `null` for missing/invalid values (not `''` or formatted text)
- [ ] No formatting logic (no date formatting, no `%`, no localization)
- [ ] No display-specific transformations
- [ ] JSDoc documents the return type
- [ ] Views handle all display formatting

## Related

- [architecture.md](./architecture.md) — modular design
- [typescript.md](./typescript.md) — type safety
- [code-quality.md](./code-quality.md) — single responsibility
