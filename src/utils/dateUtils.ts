import { Timestamp } from 'firebase/firestore';

/** Convert a Firestore Timestamp or Date (or null/undefined) to a JS Date. */
export function toDate(value: Date | Timestamp | null | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  // Defensive: handle plain objects with .toDate (e.g. server snapshots not fully hydrated)
  if (typeof (value as any).toDate === 'function') return (value as any).toDate();
  return undefined;
}

/** Get milliseconds from a Date|Timestamp. Returns 0 if missing/invalid. */
export function toMillis(value: Date | Timestamp | null | undefined): number {
  const d = toDate(value);
  return d ? d.getTime() : 0;
}
