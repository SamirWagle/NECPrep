import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { orderOptions, assignOptionOrders } from '../localData';
import { quarantinedIds } from '../../data/quarantine';

const BOOKS_DIR = join(process.cwd(), 'public', 'data', 'books');

interface RawQuestion {
  qsns: string;
  opt1: string;
  opt2: string;
  opt3: string;
  opt4: string;
  correct_option: string;
  correct_option_index: number;
}

function loadBank(): Array<{ topicId: string; idx: number; q: RawQuestion }> {
  const files = readdirSync(BOOKS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  const out: Array<{ topicId: string; idx: number; q: RawQuestion }> = [];
  for (const file of files) {
    const topicId = `book-${file.replace('.json', '')}`;
    const rows: RawQuestion[] = JSON.parse(readFileSync(join(BOOKS_DIR, file), 'utf8'));
    rows.forEach((q, idx) => out.push({ topicId, idx, q }));
  }
  return out;
}

/** Chi-square of observed counts against a uniform distribution. */
function chiSquare(counts: number[]): number {
  const n = counts.reduce((a, b) => a + b, 0);
  if (n === 0) return 0;
  const expected = n / counts.length;
  return counts.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0);
}

describe('orderOptions', () => {
  it('preserves the set of options and keeps the answer pointing at the same text', () => {
    const options = ['Alpha', 'Beta', 'Gamma', 'Delta'];
    for (let correct = 0; correct < options.length; correct++) {
      const result = orderOptions(options, correct, `seed-${correct}`);
      expect([...result.options].sort()).toEqual([...options].sort());
      expect(result.options[result.correctIndex]).toBe(options[correct]);
    }
  });

  it('is deterministic for a given seed', () => {
    const options = ['A', 'B', 'C', 'D'];
    const a = orderOptions(options, 1, 'book-ch1_42');
    const b = orderOptions(options, 1, 'book-ch1_42');
    expect(a.options).toEqual(b.options);
    expect(a.correctIndex).toBe(b.correctIndex);
  });

  it('produces different orders for different seeds', () => {
    const options = ['A', 'B', 'C', 'D'];
    const orders = new Set(
      Array.from({ length: 40 }, (_, i) => orderOptions(options, 0, `seed-${i}`).options.join(''))
    );
    // With 24 possible permutations, 40 seeds should hit well more than one.
    expect(orders.size).toBeGreaterThan(5);
  });

  it('pins "all of the above" style options last', () => {
    const cases = [
      ['One', 'Two', 'Three', 'All of the above'],
      ['One', 'Two', 'None of these', 'Three'],
      ['Both of the above', 'One', 'Two', 'Three'],
    ];
    for (const options of cases) {
      const positional = options.filter((o) => /^(all|none|both)\s/i.test(o));
      const result = orderOptions(options, 0, 'any-seed');
      const tail = result.options.slice(result.options.length - positional.length);
      expect(tail).toEqual(positional);
    }
  });

  it('leaves degenerate inputs untouched', () => {
    expect(orderOptions(['Only'], 0, 's')).toEqual({ options: ['Only'], correctIndex: 0 });
    // One free option plus one pinned: nothing meaningful to shuffle.
    const single = orderOptions(['A', 'All of the above'], 0, 's');
    expect(single.options).toEqual(['A', 'All of the above']);
  });

  it('carries the no-answer-key sentinel through unchanged', () => {
    const result = orderOptions(['A', 'B', 'C', 'D'], -1, 'seed');
    expect(result.correctIndex).toBe(-1);
  });
});

describe('answer-position bias across the real question bank', () => {
  // As authored the bank is badly skewed: the correct answer sits in option 2
  // for 32.6% of rows (chi-square 155 on 3 df), reaching 65% in ch9 and 56% in
  // ch6, while ch3 puts 47% in option 1. Options were never reordered, so a
  // student could score 65% on ch9 by blind-guessing "2" and would learn the
  // tell instead of the material.
  //
  // assignOptionOrders() removes this by assigning slots across a whole chapter
  // at once. These assertions are the regression guard, and they are deliberately
  // tight: balancing by construction leaves no sampling error to absorb, so there
  // is no reason to leave slack. An earlier version of this code drew an
  // independent permutation per question, which only fixed the bias in
  // expectation and left ch1 at 33.5% on one unlucky draw.
  const bank = loadBank();

  /** The questions a student can actually be served, per chapter. */
  function servableByChapter(): Map<string, Array<{ id: string; options: string[]; correctIndex: number }>> {
    const byTopic = new Map<string, Array<{ id: string; options: string[]; correctIndex: number }>>();
    for (const { topicId, idx, q } of bank) {
      const id = `${topicId}_${idx}`;
      if (quarantinedIds.has(id)) continue;
      const options = [q.opt1, q.opt2, q.opt3, q.opt4].filter(Boolean);
      const correctIndex = q.correct_option_index - 1;
      if (correctIndex < 0 || correctIndex >= options.length) continue;
      if (!byTopic.has(topicId)) byTopic.set(topicId, []);
      byTopic.get(topicId)!.push({ id, options, correctIndex });
    }
    return byTopic;
  }

  it('has enough questions to be worth measuring', () => {
    expect(bank.length).toBeGreaterThan(2000);
  });

  it('confirms the raw bank really is biased (guards against a vacuous test)', () => {
    // If this ever fails, the underlying data was rebalanced upstream. That is
    // good news, but it means the assertions below no longer prove anything and
    // must be re-examined rather than deleted.
    const raw = [0, 0, 0, 0];
    for (const { q } of bank) {
      const ci = q.correct_option_index - 1;
      if (ci >= 0 && ci < 4) raw[ci]++;
    }
    expect(chiSquare(raw)).toBeGreaterThan(100);
  });

  it('flattens the distribution across the whole bank', () => {
    const after = [0, 0, 0, 0];
    for (const questions of servableByChapter().values()) {
      for (const { correctIndex } of assignOptionOrders(questions)) {
        if (correctIndex >= 0 && correctIndex < 4) after[correctIndex]++;
      }
    }

    const n = after.reduce((a, b) => a + b, 0);
    expect(n).toBeGreaterThan(2000);

    // Measured 0.02 at the time of writing. p < 0.05 for df=3 would be 7.81, so
    // this is roughly 400x tighter than statistical indistinguishability.
    expect(chiSquare(after)).toBeLessThan(1);
    expect(Math.max(...after) / n).toBeLessThan(0.26);
  });

  it('flattens every chapter individually, including the small ones', () => {
    // No minimum-n skip. The previous version skipped chapters under 100
    // questions, which silently exempted ch5, ch6, ch7 and ch9 - and ch7 (35.8%)
    // and ch9 (35.2%) were the two worst chapters in the bank.
    const byTopic = servableByChapter();
    expect(byTopic.size).toBe(10);

    for (const [topicId, questions] of byTopic) {
      const counts = [0, 0, 0, 0];
      for (const { correctIndex } of assignOptionOrders(questions)) {
        if (correctIndex >= 0 && correctIndex < 4) counts[correctIndex]++;
      }
      const n = counts.reduce((a, b) => a + b, 0);
      const worst = Math.max(...counts) / n;
      // Every chapter measured 25.0-26.1%. 27% leaves room for a chapter whose
      // pinned "all of the above" options genuinely constrain the balance.
      expect(worst, `${topicId} worst slot share (n=${n})`).toBeLessThan(0.27);
    }
  });

  it('never changes which option text is correct', () => {
    // The whole point of reordering is that it is cosmetic. If this fails, the
    // app is grading against a different answer than the bank specifies.
    for (const questions of servableByChapter().values()) {
      const ordered = assignOptionOrders(questions);
      questions.forEach((q, i) => {
        const expected = q.options[q.correctIndex];
        const actual = ordered[i].options[ordered[i].correctIndex];
        expect(actual, `answer text changed for ${q.id}`).toBe(expected);
        expect([...ordered[i].options].sort()).toEqual([...q.options].sort());
      });
    }
  });

  it('keeps positional options last in every chapter', () => {
    const positional = /^\s*(all|none|both)\s+(of\s+)?(the\s+)?(above|these|mentioned)/i;
    let checked = 0;
    for (const questions of servableByChapter().values()) {
      const ordered = assignOptionOrders(questions);
      for (const { options } of ordered) {
        const pinned = options.filter((o) => positional.test(o));
        if (pinned.length === 0) continue;
        checked++;
        expect(options.slice(options.length - pinned.length)).toEqual(pinned);
      }
    }
    // The bank contains hundreds of these; a zero here would mean the regex
    // stopped matching and this test had quietly become a no-op.
    expect(checked).toBeGreaterThan(100);
  });

  it('is stable across repeated calls, so stored answer indices stay valid', () => {
    for (const questions of servableByChapter().values()) {
      const a = assignOptionOrders(questions);
      const b = assignOptionOrders(questions);
      expect(a).toEqual(b);
    }
  });
});
