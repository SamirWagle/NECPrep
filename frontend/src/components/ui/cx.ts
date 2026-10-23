/**
 * Minimal class-name joiner. Every primitive in this folder takes a
 * `className` and merges it *after* its own classes so consumer styles win
 * at equal specificity.
 */
export type ClassValue = string | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  let out = '';
  for (const value of values) {
    if (!value) continue;
    out = out ? `${out} ${value}` : value;
  }
  return out;
}
