/**
 * Request parsing. Fails closed at every step.
 *
 * Three things go wrong with request handling in practice, and all three are
 * handled here rather than in each route:
 *
 * - A body that is not JSON, or is JSON but not an object. Both are a 400 with
 *   a clear message, never a crash inside a handler.
 * - A body that is too large. Checked against `Content-Length` BEFORE reading,
 *   so a hostile client cannot make the Worker buffer megabytes.
 * - Query strings, which are always strings. Numeric parameters are coerced
 *   explicitly, by name, and a value that is not a number is a 400 - not a
 *   silent `NaN` that pages from the start of a table.
 */

import { ApiException } from '../shared/errors.ts';
import { safeParse } from '../validation/v.ts';
import type { Schema } from '../validation/v.ts';
import { MAX_BODY_BYTES } from '../validation/schemas.ts';

function badRequest(issues: Record<string, string>): never {
  throw new ApiException('BAD_REQUEST', 'The request body is invalid.', {
    fields: issues,
  });
}

/** Validates an already-parsed value against a schema. */
export function validate<T>(schema: Schema<T>, raw: unknown): T {
  const result = safeParse(schema, raw);
  if (!result.success) badRequest(result.error.issues);
  return result.data;
}

export interface BodyRequest {
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

/** Reads and validates a JSON body. */
export async function readJsonBody<T>(
  request: BodyRequest,
  schema: Schema<T>,
): Promise<T> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number.parseInt(declaredLength, 10);
    if (Number.isInteger(length) && length > MAX_BODY_BYTES) {
      throw new ApiException('PAYLOAD_TOO_LARGE', 'That request is too large.');
    }
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    badRequest({ '': 'Expected a JSON body.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    badRequest({ '': 'Malformed JSON.' });
  }

  return validate(schema, raw);
}

/**
 * Builds a plain object from a query string, coercing the named keys to
 * numbers.
 *
 * A number-shaped parameter that is not a number is left as the original
 * string, so the schema reports `Expected a finite number` against the right
 * field instead of this function inventing a default.
 */
export function queryObject(
  url: URL,
  numericKeys: readonly string[] = [],
): Record<string, unknown> {
  const numeric = new Set(numericKeys);
  const out: Record<string, unknown> = {};

  for (const [key, value] of url.searchParams) {
    if (!numeric.has(key)) {
      out[key] = value;
      continue;
    }
    if (value === '') continue;
    const parsed = Number(value);
    out[key] = Number.isFinite(parsed) ? parsed : value;
  }

  return out;
}

/** Validates a path parameter as an opaque entity id. */
export function pathId(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    badRequest({ [name]: 'Missing or malformed.' });
  }
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) {
    badRequest({ [name]: 'Malformed identifier.' });
  }
  return value;
}
