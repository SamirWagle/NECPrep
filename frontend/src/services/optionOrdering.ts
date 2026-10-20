/**
 * Answer-option ordering.
 *
 * ## Why this exists
 *
 * The authored question bank has a severe answer-position bias. As written, the
 * correct answer sits in option 2 for 32.6% of the bank (chi-square 155 on 3 df),
 * and per chapter it reaches 65% in ch9, 56% in ch6, 50% in ch8, while ch3 puts
 * 47% in option 1. Options were never reordered anywhere in the app, so a student
 * could score 65% on ch9 by blind-guessing "2" — learning the tell instead of the
 * material, then meeting a real exam that has no such tell.
 *
 * ## Why ordering is assigned per chapter, not per question
 *
 * The obvious fix — give each question an independent pseudo-random permutation
 * seeded from its id — was tried and is not good enough. An independent draw only
 * removes the bias *in expectation*; any particular draw still lands a sampling
 * error of roughly one standard deviation, which at n = 474 (ch1) is about 2
 * percentage points per slot. One real draw put 159 of 474 ch1 answers in slot 2
 * against an expectation of 132, i.e. 33.5%, barely better than leaving it alone.
 * Worse, the draw is a function of question ids, and ids are array positions, so
 * deleting a single duplicate row reshuffles every seed in the file and re-rolls
 * the dice on the whole chapter. That makes the distribution unpredictable across
 * ordinary data edits.
 *
 * Assigning positions across a whole chapter at once removes the sampling error
 * by construction: every slot gets its fair share because the share is computed,
 * not sampled.
 *
 * ## Properties this function guarantees
 *
 * - **Balanced.** Within a chapter, correct answers are spread as evenly across
 *   the available display slots as the content permits.
 * - **Deterministic.** The output depends only on the input array. Stored answers
 *   are option *indices* (in localStorage drafts, progress records and, later,
 *   server rows), so a permutation that varied between loads would silently
 *   re-point every answer a user has already given.
 * - **Positional options stay last.** "All of the above" and friends are pinned to
 *   the end in their original relative order; moving one mid-list makes the
 *   question nonsense. 585 such options exist in the bank, 583 of them already in
 *   slot 4. Pinning constrains the balance: a question with one pinned option can
 *   only place a free correct answer in slots 1-3, so slot 4 can be filled only by
 *   questions with no pinned option, or by questions whose answer *is* the pinned
 *   option. In the current bank there are enough of the former that every chapter
 *   still reaches ~25.1%; a bank with far more positional options would not.
 * - **No index-correlated pattern.** Slots are assigned least-loaded-first over a
 *   hash-scrambled traversal, not round-robin in array order. Naive round-robin
 *   balances just as well but makes consecutive questions cycle 1,2,3,4,1,2,3,4 —
 *   a new tell, replacing the one being removed.
 */

/**
 * Options whose meaning depends on being last. Pinned, never shuffled.
 */
export const POSITIONAL_OPTION_RE =
  /^\s*(all|none|both)\s+(of\s+)?(the\s+)?(above|these|mentioned)/i;

/** FNV-1a: turns a question id into a stable 32-bit seed. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, seedable PRNG. */
export function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform Fisher-Yates. */
export function fisherYates<T>(arr: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface OrderableQuestion {
  /** Stable key used for seeding. Two questions must not share one. */
  id: string;
  options: readonly string[];
  /** Index into `options`, or -1 for "no answer key". */
  correctIndex: number;
}

export interface OrderedOptions {
  options: string[];
  correctIndex: number;
}

/** Splits option indices into pinned (positional) and free, preserving order. */
function partition(options: readonly string[]): { free: number[]; pinned: number[] } {
  const free: number[] = [];
  const pinned: number[] = [];
  options.forEach((o, i) => {
    if (POSITIONAL_OPTION_RE.test(o)) pinned.push(i);
    else free.push(i);
  });
  return { free, pinned };
}

/**
 * True when there is nothing meaningful to reorder: fewer than two options
 * overall, or fewer than two *free* options (one free option plus pinned tails
 * has only one possible arrangement).
 */
function isDegenerate(options: readonly string[], free: number[]): boolean {
  return options.length < 2 || free.length < 2;
}

/**
 * Orders the options of one question in isolation.
 *
 * Kept for single-question callers and for tests. Prefer
 * {@link assignOptionOrders} for a whole chapter: this function can only draw
 * independently and therefore carries the sampling error described above.
 */
export function orderOptions(
  options: readonly string[],
  correctIndex: number,
  seedKey: string
): OrderedOptions {
  const { free, pinned } = partition(options);
  if (isDegenerate(options, free)) {
    return { options: [...options], correctIndex };
  }

  const order = [...fisherYates(free, seededRandom(hashSeed(seedKey))), ...pinned];
  return {
    options: order.map((i) => options[i]),
    correctIndex: correctIndex >= 0 ? order.indexOf(correctIndex) : correctIndex,
  };
}

/**
 * Orders the options of every question in a chapter, balancing which display
 * slot holds the correct answer across the chapter as a whole.
 *
 * Returns results positionally aligned with `questions`.
 */
export function assignOptionOrders(questions: readonly OrderableQuestion[]): OrderedOptions[] {
  const results = new Array<OrderedOptions>(questions.length);

  // How many correct answers have landed in each display slot so far. Sized to
  // the widest question so a 5-option set would not overflow.
  const maxOptions = questions.reduce((m, q) => Math.max(m, q.options.length), 0);
  const slotLoad = new Array<number>(Math.max(maxOptions, 1)).fill(0);

  interface Plan {
    index: number;
    free: number[];
    pinned: number[];
    /** Slot the correct answer must occupy, or null if we may choose. */
    forcedSlot: number | null;
  }

  const plans: Plan[] = [];

  for (let index = 0; index < questions.length; index++) {
    const q = questions[index];
    const { free, pinned } = partition(q.options);

    if (isDegenerate(q.options, free)) {
      results[index] = { options: [...q.options], correctIndex: q.correctIndex };
      // A degenerate question still shows its answer in a slot, so it must count
      // toward the load or the balance would be computed against a partial view.
      if (q.correctIndex >= 0 && q.correctIndex < slotLoad.length) slotLoad[q.correctIndex]++;
      continue;
    }

    // A pinned correct answer cannot move: pinned options are appended after the
    // free ones in their original relative order.
    const pinnedRank = pinned.indexOf(q.correctIndex);
    const forcedSlot =
      q.correctIndex < 0 ? null : pinnedRank >= 0 ? free.length + pinnedRank : null;

    plans.push({ index, free, pinned, forcedSlot });
  }

  // Count the forced placements first, so the free ones balance against reality
  // rather than against an empty board.
  for (const plan of plans) {
    if (plan.forcedSlot !== null && plan.forcedSlot < slotLoad.length) {
      slotLoad[plan.forcedSlot]++;
    }
  }

  // Traverse in hash-scrambled order so slot choice does not track array index.
  const freePlans = plans
    .filter((p) => p.forcedSlot === null)
    .sort((a, b) => {
      const ha = hashSeed(questions[a.index].id);
      const hb = hashSeed(questions[b.index].id);
      return ha === hb ? a.index - b.index : ha - hb;
    });

  const chosenSlot = new Map<number, number>();

  for (const plan of freePlans) {
    const q = questions[plan.index];

    if (q.correctIndex < 0) {
      // No answer key: nothing to balance, just shuffle for consistency.
      chosenSlot.set(plan.index, -1);
      continue;
    }

    // Feasible slots are exactly the free slots, 0 .. free.length - 1.
    let best = 0;
    let bestLoad = Infinity;
    const rand = seededRandom(hashSeed(`slot:${q.id}`));
    for (let slot = 0; slot < plan.free.length; slot++) {
      const load = slotLoad[slot];
      // Random tie-break so equal loads do not always resolve to the lowest slot.
      if (load < bestLoad || (load === bestLoad && rand() < 0.5)) {
        best = slot;
        bestLoad = load;
      }
    }

    slotLoad[best]++;
    chosenSlot.set(plan.index, best);
  }

  // Materialise each permutation.
  for (const plan of plans) {
    const q = questions[plan.index];
    const rand = seededRandom(hashSeed(`perm:${q.id}`));

    let freeOrder: number[];

    if (plan.forcedSlot !== null || q.correctIndex < 0) {
      // Nothing to place deliberately; a plain shuffle of the free options.
      freeOrder = fisherYates(plan.free, rand);
    } else {
      const target = chosenSlot.get(plan.index) ?? 0;
      const others = fisherYates(
        plan.free.filter((i) => i !== q.correctIndex),
        rand
      );
      freeOrder = [];
      let cursor = 0;
      for (let slot = 0; slot < plan.free.length; slot++) {
        freeOrder.push(slot === target ? q.correctIndex : others[cursor++]);
      }
    }

    const order = [...freeOrder, ...plan.pinned];
    results[plan.index] = {
      options: order.map((i) => q.options[i]),
      correctIndex: q.correctIndex >= 0 ? order.indexOf(q.correctIndex) : q.correctIndex,
    };
  }

  return results;
}

/**
 * A lower bound on the worst-slot share a chapter could reach.
 *
 * Counts the placements that are forced (the correct answer *is* a pinned
 * option, so its slot is fixed) and then spreads the remaining answers evenly
 * over the four slots. This is optimistic: it does not verify that slot 4 is
 * actually reachable for each remaining answer, which it is not for any question
 * carrying a pinned option. So treat the result as "no assignment can do better
 * than this", not as "this is achievable".
 *
 * Used by the validator so a chapter failing the bias gate can say whether it hit
 * an unlucky assignment or a genuine content ceiling. On the current bank the
 * bound is tight — {@link assignOptionOrders} reaches it for all ten chapters.
 */
export function attainableWorstShare(questions: readonly OrderableQuestion[]): number {
  const slots = new Array<number>(4).fill(0);
  let keyed = 0;

  for (const q of questions) {
    if (q.correctIndex < 0) continue;
    keyed++;
    const { free, pinned } = partition(q.options);
    const pinnedRank = pinned.indexOf(q.correctIndex);
    if (!isDegenerate(q.options, free) && pinnedRank >= 0) {
      slots[Math.min(free.length + pinnedRank, 3)]++;
    }
  }

  // Spread every unconstrained answer as evenly as possible over slots 0..3.
  const forced = slots.reduce((a, b) => a + b, 0);
  let remaining = keyed - forced;
  const ideal = [...slots];
  while (remaining > 0) {
    let min = 0;
    for (let i = 1; i < 4; i++) if (ideal[i] < ideal[min]) min = i;
    ideal[min]++;
    remaining--;
  }

  return keyed === 0 ? 0 : Math.max(...ideal) / keyed;
}
