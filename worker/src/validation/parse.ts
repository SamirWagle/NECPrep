/**
 * The bridge between Zod and this API's error shape.
 *
 * ===========================================================================
 * THIS REPLACED A HAND-WRITTEN VALIDATOR
 * ===========================================================================
 *
 * `validation/v.ts` was a deliberately Zod-shaped subset written because
 * `worker/package.json` was outside the scope of the change that needed it.
 * Zod is now a real dependency and the hand-written one is gone. What survives
 * is this file, because the two behaviours that mattered about it are NOT Zod
 * defaults and are worth keeping explicit:
 *
 * 1. IT FAILS CLOSED ON UNKNOWN KEYS. Every schema is `z.strictObject`, never
 *    `z.object`: Zod's default is to STRIP an unrecognised key, and stripping
 *    is the worst of the three options at this boundary. Validated bodies are
 *    passed straight into the data layer, so a silently-dropped `attemptID`
 *    typo reads as a missing required field, while a silently-KEPT extra field
 *    would be a way to append columns to a write. A client that sends
 *    `{ score: 100 }` to `POST /api/mock/submit` gets a 400 naming the field.
 *
 * 2. EVERY ISSUE IS REPORTED AT ONCE, keyed by dotted path, so the 400 tells
 *    the client which fields to fix in one round trip. Zod's `ZodError.issues`
 *    is an ARRAY of objects with structured paths; `ApiError.fields` is a flat
 *    `Record<path, message>` that the frontend renders next to inputs. This
 *    file is the only place that translation lives.
 *
 * It also normalises two things Zod spells differently from the rest of this
 * codebase: an `unrecognized_keys` issue arrives with an EMPTY path and a list
 * of offending keys, so it is fanned out to one entry per key; and array
 * indices become `field[0]` rather than `field.0`, which is what a client's
 * form bindings expect.
 */

import { z } from 'zod';

/** Any Zod schema, as this codebase passes them around. */
export type Schema<T> = z.ZodType<T>;

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: Record<string, string> } };

/** `['answers', '__proto__']` -> `answers.__proto__`; `['ids', 0]` -> `ids[0]`. */
function dotted(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else {
      out += out.length === 0 ? String(segment) : `.${String(segment)}`;
    }
  }
  return out;
}

/**
 * Flattens a `ZodError` into `Record<dottedPath, message>`.
 *
 * First issue per path wins, which is the most specific one: Zod runs the base
 * type check before any refinement, so a field that is both the wrong type and
 * out of range reports the type error -- the one the client has to fix first.
 */
export function flattenIssues(error: z.ZodError): Record<string, string> {
  const issues: Record<string, string> = {};
  const record = (path: readonly PropertyKey[], message: string): void => {
    const key = dotted(path);
    if (!(key in issues)) issues[key] = message;
  };

  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      // Reported once for the object, with the offending keys in a list. Fanned
      // out so the client gets one message per field, at that field's own path.
      for (const key of issue.keys) {
        record([...issue.path, key], 'Unexpected field.');
      }
      continue;
    }
    record(issue.path, issue.message);
  }

  // Guarantee at least one issue, so a 400 is never an empty object.
  if (Object.keys(issues).length === 0) issues[''] = 'Invalid request body.';
  return issues;
}

/**
 * `safeParse(schema, input)`, with the argument order this codebase uses.
 *
 * Deliberately a free function rather than `schema.safeParse(input)`: the
 * schema is the thing that varies at a call site and the input is the thing
 * being checked, so reading it as a predicate over the input is the right way
 * round -- and it keeps every caller one import away from the flattening above
 * instead of remembering to apply it.
 */
export function safeParse<T>(schema: Schema<T>, input: unknown): ParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: { issues: flattenIssues(result.error) } };
}
