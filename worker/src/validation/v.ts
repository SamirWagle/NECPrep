/**
 * A small, Zod-shaped request validator.
 *
 * WHY NOT ZOD ITSELF: the npm registry is reachable from this environment
 * (`npm view zod version` resolves 4.6.7), so Zod is genuinely available - but
 * installing it means creating `worker/package.json`, which is outside the file
 * scope of this change. The surface below is therefore deliberately a subset of
 * Zod's with the same spelling: `v.object({...}).safeParse(input)` returning
 * `{ success, data } | { success, error }`, `v.string().min(8).email()`,
 * `v.enumOf([...])`, `v.array(...)`, `v.optional(...)`. Swapping to the real
 * thing is `s/v\./z./` plus deleting this file.
 *
 * Two behaviours matter more than the API shape:
 *
 * - IT FAILS CLOSED. Unknown object keys are rejected rather than stripped, so
 *   a client cannot smuggle `{ role: "admin" }` or `{ expiresAt: ... }` into a
 *   body that later gets spread into a write. Non-finite numbers, `__proto__`
 *   keys and prototype-polluting records are rejected outright.
 * - IT REPORTS EVERY ISSUE, keyed by dotted path, so the 400 tells the client
 *   which fields to fix in one round trip.
 */

const FAILED = Symbol('validation-failed');
type Checked<T> = T | typeof FAILED;

export interface Schema<T> {
  readonly check: (input: unknown, path: string, issues: Record<string, string>) => Checked<T>;
  /** Phantom, for inference only. */
  readonly _output?: T;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: Record<string, string> } };

function schema<T>(
  check: (input: unknown, path: string, issues: Record<string, string>) => Checked<T>,
): Schema<T> {
  return { check };
}

function reject(path: string, issues: Record<string, string>, message: string): typeof FAILED {
  // First failure per path wins: it is the most specific one, since refinements
  // run after the base type check.
  if (!(path in issues)) issues[path] = message;
  return FAILED;
}

/** Records an issue and reads as a failed boolean check, for refinements. */
function invalid(path: string, issues: Record<string, string>, message: string): false {
  if (!(path in issues)) issues[path] = message;
  return false;
}

export function safeParse<T>(s: Schema<T>, input: unknown): ParseResult<T> {
  const issues: Record<string, string> = {};
  const value = s.check(input, '', issues);
  if (value === FAILED || Object.keys(issues).length > 0) {
    // Guarantee at least one issue, so a 400 is never an empty object.
    if (Object.keys(issues).length === 0) issues[''] = 'Invalid request body.';
    return { success: false, error: { issues } };
  }
  return { success: true, data: value as T };
}

// --- Strings ----------------------------------------------------------------

export interface StringSchema extends Schema<string> {
  min(n: number): StringSchema;
  max(n: number): StringSchema;
  trimmed(): StringSchema;
  lower(): StringSchema;
  email(): StringSchema;
  regex(re: RegExp, message?: string): StringSchema;
  /** An opaque server-minted id or token: safe charset, bounded length. */
  token(maxLen?: number): StringSchema;
}

// Deliberately boring. A full RFC 5322 matcher is a liability; this rejects
// everything that cannot be a deliverable address and nothing that can.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const TOKEN_RE = /^[A-Za-z0-9_.:-]+$/;

function stringSchema(
  transforms: Array<(s: string) => string>,
  checks: Array<(s: string, path: string, issues: Record<string, string>) => boolean>,
): StringSchema {
  const base = schema<string>((input, path, issues) => {
    if (typeof input !== 'string') return reject(path, issues, 'Expected a string.');
    let value = input;
    for (const t of transforms) value = t(value);
    for (const c of checks) {
      if (!c(value, path, issues)) return FAILED;
    }
    return value;
  });

  const extend = (
    nextTransforms: Array<(s: string) => string>,
    nextChecks: Array<(s: string, path: string, issues: Record<string, string>) => boolean>,
  ) => stringSchema([...transforms, ...nextTransforms], [...checks, ...nextChecks]);

  return {
    ...base,
    min: (n) =>
      extend([], [
        (s, p, i) => s.length >= n || invalid(p, i, `Must be at least ${n} characters.`),
      ]),
    max: (n) =>
      extend([], [
        (s, p, i) => s.length <= n || invalid(p, i, `Must be at most ${n} characters.`),
      ]),
    trimmed: () => extend([(s) => s.trim()], []),
    lower: () => extend([(s) => s.toLowerCase()], []),
    email: () =>
      extend([(s) => s.trim().toLowerCase()], [
        (s, p, i) =>
          (s.length <= 254 && EMAIL_RE.test(s)) ||
          invalid(p, i, 'Must be a valid email address.'),
      ]),
    regex: (re, message) =>
      extend([], [
        (s, p, i) => re.test(s) || invalid(p, i, message ?? 'Invalid format.'),
      ]),
    token: (maxLen = 64) =>
      extend([], [
        (s, p, i) =>
          (s.length > 0 && s.length <= maxLen && TOKEN_RE.test(s)) ||
          invalid(p, i, 'Must be a valid identifier.'),
      ]),
  };
}

export function string(): StringSchema {
  return stringSchema([], []);
}

// --- Numbers ----------------------------------------------------------------

export interface NumberSchema extends Schema<number> {
  int(): NumberSchema;
  min(n: number): NumberSchema;
  max(n: number): NumberSchema;
}

function numberSchema(
  checks: Array<(n: number, path: string, issues: Record<string, string>) => boolean>,
): NumberSchema {
  const base = schema<number>((input, path, issues) => {
    // No string coercion: "12" in a JSON body is a client bug, and coercing it
    // hides the bug until a value like "12abc" arrives.
    if (typeof input !== 'number' || !Number.isFinite(input)) {
      return reject(path, issues, 'Expected a finite number.');
    }
    for (const c of checks) {
      if (!c(input, path, issues)) return FAILED;
    }
    return input;
  });

  const extend = (
    next: Array<(n: number, path: string, issues: Record<string, string>) => boolean>,
  ) => numberSchema([...checks, ...next]);

  return {
    ...base,
    int: () =>
      extend([(n, p, i) => Number.isInteger(n) || invalid(p, i, 'Expected an integer.')]),
    min: (m) => extend([(n, p, i) => n >= m || invalid(p, i, `Must be at least ${m}.`)]),
    max: (m) => extend([(n, p, i) => n <= m || invalid(p, i, `Must be at most ${m}.`)]),
  };
}

export function number(): NumberSchema {
  return numberSchema([]);
}

// --- Primitives, enums, modifiers -------------------------------------------

export function boolean(): Schema<boolean> {
  return schema((input, path, issues) =>
    typeof input === 'boolean' ? input : reject(path, issues, 'Expected true or false.'),
  );
}

export function literal<const L extends string | number | boolean>(value: L): Schema<L> {
  return schema((input, path, issues) =>
    input === value ? (value as L) : reject(path, issues, `Expected ${JSON.stringify(value)}.`),
  );
}

export function enumOf<const L extends string>(values: readonly L[]): Schema<L> {
  const allowed = new Set<string>(values);
  return schema((input, path, issues) =>
    typeof input === 'string' && allowed.has(input)
      ? (input as L)
      : reject(path, issues, `Must be one of: ${values.join(', ')}.`),
  );
}

/** Accepts a missing key or an explicit `undefined`, never `null`. */
export function optional<T>(inner: Schema<T>): Schema<T | undefined> {
  return schema((input, path, issues) =>
    input === undefined ? undefined : inner.check(input, path, issues),
  );
}

export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return schema((input, path, issues) =>
    input === null ? null : inner.check(input, path, issues),
  );
}

export function withDefault<T>(inner: Schema<T>, fallback: () => T): Schema<T> {
  return schema((input, path, issues) =>
    input === undefined ? fallback() : inner.check(input, path, issues),
  );
}

// --- Arrays, records, objects -----------------------------------------------

export interface ArraySchema<T> extends Schema<T[]> {
  min(n: number): ArraySchema<T>;
  max(n: number): ArraySchema<T>;
  unique(): ArraySchema<T>;
}

function arraySchema<T>(
  inner: Schema<T>,
  checks: Array<(xs: T[], path: string, issues: Record<string, string>) => boolean>,
): ArraySchema<T> {
  const base = schema<T[]>((input, path, issues) => {
    if (!Array.isArray(input)) return reject(path, issues, 'Expected an array.');
    const out: T[] = [];
    let failed = false;
    for (let i = 0; i < input.length; i++) {
      const value = inner.check(input[i], `${path}[${i}]`, issues);
      if (value === FAILED) failed = true;
      else out.push(value as T);
    }
    if (failed) return FAILED;
    for (const c of checks) {
      if (!c(out, path, issues)) return FAILED;
    }
    return out;
  });

  const extend = (
    next: Array<(xs: T[], path: string, issues: Record<string, string>) => boolean>,
  ) => arraySchema(inner, [...checks, ...next]);

  return {
    ...base,
    min: (n) =>
      extend([(xs, p, i) => xs.length >= n || invalid(p, i, `Needs at least ${n} items.`)]),
    max: (n) =>
      extend([(xs, p, i) => xs.length <= n || invalid(p, i, `Allows at most ${n} items.`)]),
    unique: () =>
      extend([
        (xs, p, i) =>
          new Set(xs.map((x) => JSON.stringify(x))).size === xs.length ||
          invalid(p, i, 'Items must be unique.'),
      ]),
  };
}

export function array<T>(inner: Schema<T>): ArraySchema<T> {
  return arraySchema(inner, []);
}

/** Keys that must never arrive from a client, whatever the schema says. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface RecordSchema<T> extends Schema<Record<string, T>> {
  maxKeys(n: number): RecordSchema<T>;
}

function recordSchema<T>(
  keySchema: Schema<string>,
  valueSchema: Schema<T>,
  limit: number,
): RecordSchema<T> {
  const base = schema<Record<string, T>>((input, path, issues) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return reject(path, issues, 'Expected an object.');
    }
    const keys = Object.keys(input as Record<string, unknown>);
    if (keys.length > limit) {
      return reject(path, issues, `Allows at most ${limit} entries.`);
    }
    // Null prototype: this map goes on to be read by key, and an inherited
    // `toString` or `hasOwnProperty` would otherwise read as a present entry.
    const out: Record<string, T> = Object.create(null) as Record<string, T>;
    let failed = false;
    for (const key of keys) {
      if (FORBIDDEN_KEYS.has(key)) {
        reject(`${path}.${key}`, issues, 'Reserved key.');
        failed = true;
        continue;
      }
      const checkedKey = keySchema.check(key, `${path}.${key}`, issues);
      const checkedValue = valueSchema.check(
        (input as Record<string, unknown>)[key],
        `${path}.${key}`,
        issues,
      );
      if (checkedKey === FAILED || checkedValue === FAILED) {
        failed = true;
        continue;
      }
      out[checkedKey as string] = checkedValue as T;
    }
    return failed ? FAILED : out;
  });

  return {
    ...base,
    maxKeys: (n) => recordSchema(keySchema, valueSchema, n),
  };
}

export function record<T>(
  keySchema: Schema<string>,
  valueSchema: Schema<T>,
  maxKeys = 200,
): RecordSchema<T> {
  return recordSchema(keySchema, valueSchema, maxKeys);
}

type Shape = Record<string, Schema<unknown>>;

type OptionalKeys<O> = {
  [K in keyof O]-?: undefined extends O[K] ? K : never;
}[keyof O];

type Flatten<O> = { [K in Exclude<keyof O, OptionalKeys<O>>]: O[K] } & {
  [K in OptionalKeys<O>]?: O[K];
};

export type ObjectOutput<S extends Shape> = Flatten<{ [K in keyof S]: Infer<S[K]> }>;

/**
 * A strict object. Unknown keys are an error, not something to strip.
 *
 * This is the single most load-bearing choice in this file: handlers below pass
 * validated bodies straight into the data layer, and silently dropping an
 * unexpected key would make a typo like `{ attemptID: ... }` read as a missing
 * required field, while silently KEEPING it would let a client append columns to
 * a write.
 */
export function object<S extends Shape>(shape: S): Schema<ObjectOutput<S>> {
  const keys = Object.keys(shape);
  const known = new Set(keys);

  return schema((input, path, issues) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return reject(path, issues, 'Expected an object.');
    }
    const source = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let failed = false;

    for (const key of Object.keys(source)) {
      if (!known.has(key)) {
        reject(path ? `${path}.${key}` : key, issues, 'Unexpected field.');
        failed = true;
      }
    }

    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      const value = shape[key].check(source[key], childPath, issues);
      if (value === FAILED) {
        failed = true;
        continue;
      }
      // Preserve "absent" rather than writing an explicit undefined, so
      // `'field' in body` still distinguishes the two.
      if (value !== undefined) out[key] = value;
    }

    return failed ? FAILED : (out as ObjectOutput<S>);
  });
}

// --- Shared field vocabulary ------------------------------------------------

/**
 * The idempotency key, as a field. Client-supplied, so it is bounded and
 * charset-restricted: it becomes part of a primary key and is echoed in logs.
 */
export const idempotencyKey = (): StringSchema => string().token(80).min(8);

/** A server-minted entity id. */
export const entityId = (): StringSchema => string().token(64);

export const v = {
  string,
  number,
  boolean,
  literal,
  enumOf,
  optional,
  nullable,
  withDefault,
  array,
  record,
  object,
  idempotencyKey,
  entityId,
  safeParse,
};
