export function sqlNow(date = new Date()): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

export function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}
