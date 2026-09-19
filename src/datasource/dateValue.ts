import { parseDateToLocal } from '@tasknotes/model/date';

/** Calendar dates use local midnight; datetimes, timestamps and Dates keep their instant. */
export function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    try {
      return parseDateToLocal(value);
    } catch {
      return null;
    }
  }

  // Keep the host's accepted datetime forms, including times without seconds.
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
