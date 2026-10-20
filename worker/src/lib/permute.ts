/**
 * Option ordering.
 *
 * Two problems are solved here, and they are not the same problem.
 *
 * 1. ANSWER-POSITION BIAS IN THE BANK. As documented in
 *    `frontend/src/services/localData.ts`, option 2 is correct in 32% of the
 *    2,801 authored questions and in 64.8% of chapter 9. Serving the authored
 *    order teaches the tell instead of the material.
 *
 * 2. THE PUBLIC ANSWER KEY IN GIT HISTORY. `frontend/public/data/books/*.json`
 *    ships `correct_option_index` and will stay in the repository's history
 *    forever. Any endpoint that returns options in the authored order lets an
 *    attacker join position-to-position and recover the key without ever
 *    looking at the database.
 *
 * So EVERY option list that leaves this Worker is permuted. Mock and practice
 * papers use a CSPRNG permutation stored per attempt; content browsing uses a
 * permutation seeded from a server-only secret plus the viewer's user id, which
 * is stable (so the UI does not reshuffle on reload) but unjoinable against the
 * public JSON.
 */

export interface OptionRow {
  id: string;
  body: string;
  /** Authored position. Used only for pinning; never sent to a client. */
  position: number;
}

/**
 * Options whose meaning depends on being last. 585 of these exist in the bank
 * and 583 sit in slot 4, so they are pinned rather than shuffled - moving one
 * into the middle of the list makes the question nonsense.
 *
 * Lifted deliberately from `localData.ts` so the server and the offline
 * localStorage path agree about what is shufflable.
 */
const POSITIONAL_OPTION_RE =
  /^\s*(all|none|both)\s+(of\s+)?(the\s+)?(above|these|mentioned)/i;

/** FNV-1a: a stable 32-bit seed from a string. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 - small, fast, seedable PRNG. Not for secrets. */
export function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Unbiased integer in [0, max) from the CSPRNG.
 *
 * `getRandomValues` then modulo would skew toward the low end; rejecting the
 * tail above the largest multiple of `max` removes that.
 */
function cryptoRandomBelow(max: number): number {
  if (max <= 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

/** Fisher-Yates over a copy. */
function fisherYates<T>(arr: readonly T[], below: (max: number) => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = below(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** CSPRNG shuffle. Used for picking questions and permuting attempt options. */
export function cryptoShuffle<T>(arr: readonly T[]): T[] {
  return fisherYates(arr, cryptoRandomBelow);
}

/** Deterministic shuffle from a string seed. */
export function seededShuffle<T>(arr: readonly T[], seedKey: string): T[] {
  const rand = seededRandom(hashSeed(seedKey));
  return fisherYates(arr, (max) => Math.floor(rand() * max));
}

/**
 * Reorders one question's options, keeping positional options ("All of the
 * above") pinned to the end in their original relative order.
 *
 * `shuffle` decides the policy: pass `cryptoShuffle` for a per-attempt paper,
 * or `(xs) => seededShuffle(xs, key)` for a stable per-viewer order.
 */
export function permuteOptions(
  options: readonly OptionRow[],
  shuffle: <T>(xs: readonly T[]) => T[],
): OptionRow[] {
  if (options.length < 2) return [...options];

  const pinned: OptionRow[] = [];
  const free: OptionRow[] = [];
  for (const o of options) {
    (POSITIONAL_OPTION_RE.test(o.body) ? pinned : free).push(o);
  }

  // Nothing is gained by shuffling fewer than two free options, and shuffling
  // one free option around pinned ones would be a no-op anyway.
  if (free.length < 2) return [...options];

  return [...shuffle(free), ...pinned];
}

/**
 * The stable per-viewer order used by the content-browsing endpoints.
 *
 * Seeded from a server-only secret so the mapping cannot be reproduced offline,
 * and from the user id so two accounts comparing notes see different orders.
 * Stable across requests because the client stores selections by option ref and
 * a reshuffle between loads would re-point them.
 */
export function browsePermutation(
  options: readonly OptionRow[],
  secret: string,
  userId: string,
  questionId: string,
): OptionRow[] {
  const key = `${secret}:${userId}:${questionId}`;
  return permuteOptions(options, (xs) => seededShuffle(xs, key));
}

/** Crockford-style base32, matching `lib/ids.ts`. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * An opaque, deterministic ref for ONE option on a content-browsing payload.
 *
 * WHY THIS EXISTS. A content endpoint cannot return the raw
 * `question_options.id`, because the id is not opaque in practice: the schema
 * mints it as `question_id || '#' || ordinal`, so the AUTHORED ORDINAL is
 * recoverable from the id by reading it. Since
 * `frontend/public/data/books/*.json` ships `correct_option_index` and is in
 * git history forever, an id of `q_abc#3` plus a published key of 3 is the
 * whole answer - no database access required, and the per-viewer permutation
 * does not help because the ordinal travels inside the id rather than as a
 * position.
 *
 * This digest is DELIBERATELY NOT REVERSIBLE, and it does not need to be: the
 * browsing endpoints are read-only. A client never submits a browse ref back -
 * answering goes through a practice session, which mints its own per-attempt
 * refs and stores the mapping. So there is nothing to look up and no table to
 * keep.
 *
 * Keyed on the server-only secret, so an attacker who somehow learns an option
 * id still cannot compute which ref corresponds to it. Deterministic in
 * (secret, user, question, option), so it is stable across reloads for one
 * viewer and differs between viewers.
 *
 * 64 bits across two independent FNV-1a rounds, which is ample: the only thing
 * a collision would do is make two options on one question share a display
 * token, and the probability across four options is on the order of 1e-19.
 */
export function browseOptionRef(
  secret: string,
  userId: string,
  questionId: string,
  optionId: string,
): string {
  const base = `${secret}:${userId}:${questionId}:${optionId}`;
  let a = hashSeed(base);
  let b = hashSeed(`${base}:${a.toString(36)}`);

  let out = '';
  for (let i = 0; i < 7; i++) {
    out += B32[a & 31];
    a = (a >>> 5) | ((a & 31) << 27);
  }
  for (let i = 0; i < 6; i++) {
    out += B32[b & 31];
    b = (b >>> 5) | ((b & 31) << 27);
  }
  return out;
}
