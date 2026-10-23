import { describe, it, expect } from 'vitest';
import {
  classifySubchapter,
  confidenceBp,
  CLASSIFIER_THRESHOLDS,
} from '../subchapterClassifier';
import { SUBCHAPTER_TERMS } from '../../data/subchapterTerms';
import { syllabusChapters, syllabusSubchapters, SUBCHAPTER_COUNT } from '../../data/syllabus';

/**
 * The classifier's value is not that it labels questions — it is that it
 * REFUSES to label the ones it cannot separate, because a wrong syllabus
 * reference shown to a student is worse than none. Most of these tests are
 * therefore about declining.
 */

const q = (bookChapterId: string, question: string, options: string[] = []) =>
  classifySubchapter({ bookChapterId, question, options });

describe('subchapter term lists', () => {
  it('covers all 60 sub-chapters, with no empty strong list', () => {
    expect(Object.keys(SUBCHAPTER_TERMS)).toHaveLength(SUBCHAPTER_COUNT);
    for (const sub of syllabusSubchapters) {
      const terms = SUBCHAPTER_TERMS[sub.code];
      expect(terms, sub.code).toBeDefined();
      expect(terms.strong.length, `${sub.code} has no strong terms`).toBeGreaterThan(0);
    }
  });

  it('never gives the same strong term to two sub-chapters of one chapter', () => {
    // A strong term shared within a chapter can only ever produce a tie, which
    // the margin rule then declines — so it is dead weight at best and a
    // silent coverage hole at worst.
    for (const chapter of syllabusChapters) {
      const seen = new Map<string, string>();
      for (const sub of chapter.subchapters) {
        for (const term of SUBCHAPTER_TERMS[sub.code].strong) {
          const owner = seen.get(term);
          expect(
            owner,
            `"${term}" is strong in both ${owner ?? ''} and ${sub.code}`
          ).toBeUndefined();
          seen.set(term, sub.code);
        }
      }
    }
  });

  it('stores terms lowercased, since matching is case-insensitive', () => {
    for (const sub of syllabusSubchapters) {
      const terms = SUBCHAPTER_TERMS[sub.code];
      for (const term of [...terms.strong, ...terms.weak]) {
        expect(term, `${sub.code}: "${term}"`).toBe(term.toLowerCase());
        expect(term.trim(), `${sub.code}: "${term}" has edge whitespace`).toBe(term);
      }
    }
  });
});

describe('classifySubchapter', () => {
  it('labels a question whose stem names its topic', () => {
    const hit = q('book-ch5', 'Which protocol provides reliable, connection-oriented delivery using a three-way handshake?');
    expect(hit?.code).toBe('ACtE0504');
    expect(hit?.displayCode).toBe('5.4');
    expect(hit?.title).toBe('Transport Layer');
  });

  it('separates neighbouring topics inside one chapter', () => {
    expect(q('book-ch5', 'A subnet mask of 255.255.255.0 in CIDR notation is written as:')?.displayCode).toBe('5.3');
    expect(q('book-ch5', 'Which cipher uses a public key and a private key?')?.displayCode).toBe('5.6');
    expect(q('book-ch5', 'CSMA/CD is used to resolve collisions in which layer?')?.displayCode).toBe('5.2');
  });

  it('declines when two sub-chapters are genuinely tied', () => {
    // One decisive term each — `tcp` for 5.4, `ospf` for 5.3 — so neither
    // clears the margin and the only honest answer is "chapter 5".
    expect(q('book-ch5', 'Does TCP sit above OSPF?')).toBeNull();
  });

  it('still picks a winner when one side has more evidence than the other', () => {
    // The counterpart to the tie above: three 5.3 terms against two 5.4 terms
    // is a real difference, not a coin flip, so declining here would be
    // over-cautious.
    expect(
      q('book-ch5', 'Compare TCP congestion control with OSPF link state routing.')?.displayCode
    ).toBe('5.3');
  });

  it('declines a stem with no topical vocabulary at all', () => {
    expect(q('book-ch7', 'Which of the following statements is true?')).toBeNull();
    expect(q('book-ch7', '')).toBeNull();
  });

  it('declines on a single weak term, which is noise rather than evidence', () => {
    // 'voltage' is weak in 1.1 and chapter-1-wide; one weak hit scores 1,
    // below MIN_SCORE.
    expect(q('book-ch1', 'The voltage is measured.')).toBeNull();
  });

  it('returns null for an unknown chapter rather than throwing', () => {
    expect(q('book-ch99', 'Thevenin equivalent resistance is found by:')).toBeNull();
    expect(q('', 'Thevenin equivalent resistance is found by:')).toBeNull();
  });

  it('does not let a distractor overrule a decisive stem', () => {
    // Regression: the stem names 10.4 outright, while the wrong answer
    // "Depreciation" is 10.2 vocabulary. Scoring stem and options together
    // closed the margin and declined a question that was never ambiguous.
    const hit = q(
      'book-ch10',
      'Which of the following is NOT a phase in the project life cycle?',
      ['Initiation', 'Planning', 'Execution', 'Depreciation']
    );
    expect(hit?.displayCode).toBe('10.4');
  });

  it('falls back to the options when the stem is generic', () => {
    // Nothing in this stem is topical, so the only evidence is in the options.
    const hit = q('book-ch6', 'Which of the following is NOT one of these?', [
      'Dijkstra',
      'A pushdown automaton',
      'A context-free grammar',
      'A parse tree',
    ]);
    expect(hit?.displayCode).toBe('6.2');
  });

  it('matches plural forms of a term', () => {
    // 'requirement elicitation' must cover "Requirements elicitation", which
    // is how the bank actually writes it.
    expect(q('book-ch8', 'Requirements elicitation techniques include:')?.displayCode).toBe('8.1');
  });

  it('treats hyphens and spaces as interchangeable', () => {
    const spaced = q('book-ch4', 'An open loop control system:');
    const hyphenated = q('book-ch4', 'An open-loop control system:');
    expect(hyphenated?.code).toBe(spaced?.code);
    expect(hyphenated?.displayCode).toBe('4.5');
  });

  it('respects word boundaries rather than matching substrings', () => {
    // 'ac' is weak in 1.3. It must not fire on "accurate", and 'ram' must not
    // fire on "program".
    expect(q('book-ch1', 'Which is the most accurate statement?')).toBeNull();
    expect(q('book-ch4', 'A program is loaded.')).toBeNull();
  });

  it('reports the terms that drove the decision', () => {
    const hit = q('book-ch9', 'Backpropagation adjusts the synaptic weights of a multilayer perceptron.');
    expect(hit?.displayCode).toBe('9.6');
    expect(hit?.matchedTerms).toContain('backpropagation');
  });

  it('never reports a sub-chapter outside the question\'s own chapter', () => {
    // A chapter-5 question must never be labelled with a chapter-3 code, even
    // when it mentions programming.
    const hit = q('book-ch5', 'A socket is created with a port number before the three-way handshake.');
    expect(hit?.code.startsWith('ACtE05')).toBe(true);
  });
});

describe('confidence', () => {
  it('stays inside 0-10000 and never claims certainty', () => {
    expect(confidenceBp(0, 0)).toBe(0);
    expect(confidenceBp(100, 0)).toBeLessThanOrEqual(9000);
    expect(confidenceBp(3, 0)).toBeGreaterThan(0);
  });

  it('rises with evidence and with separation from the runner-up', () => {
    expect(confidenceBp(12, 0)).toBeGreaterThan(confidenceBp(3, 0));
    expect(confidenceBp(6, 0)).toBeGreaterThan(confidenceBp(6, 4));
  });

  it('is an integer, because D1 stores it in an INTEGER column', () => {
    for (const [top, runner] of [[3, 0], [7, 2], [11, 5], [4, 1]]) {
      expect(Number.isInteger(confidenceBp(top, runner))).toBe(true);
    }
  });

  it('reports a real confidence on every labelled question', () => {
    const hit = q('book-ch2', 'What is the decimal equivalent of the binary number 1011?');
    expect(hit).not.toBeNull();
    expect(hit?.confidenceBp).toBeGreaterThan(0);
    expect(hit?.confidenceBp).toBeLessThanOrEqual(9000);
  });
});

describe('thresholds', () => {
  it('requires more than one weak term to label anything', () => {
    expect(CLASSIFIER_THRESHOLDS.MIN_SCORE).toBeGreaterThan(
      CLASSIFIER_THRESHOLDS.WEAK_WEIGHT
    );
  });

  it('discounts options relative to the stem', () => {
    expect(CLASSIFIER_THRESHOLDS.OPTION_WEIGHT).toBeLessThan(1);
    expect(CLASSIFIER_THRESHOLDS.OPTION_WEIGHT).toBeGreaterThan(0);
  });
});
