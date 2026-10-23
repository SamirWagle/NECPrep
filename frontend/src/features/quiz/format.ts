/** Formatting helpers shared by the quiz components. Pure. */

import type { Verdict } from './types';

/** `mm:ss`, or `h:mm:ss` past an hour. Negative input clamps to zero. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Spoken form for screen readers — "4 minutes 20 seconds" beats "04:20". */
export function describeClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  return `${minutes} minute${minutes === 1 ? '' : 's'} ${seconds} second${seconds === 1 ? '' : 's'}`;
}

/** A, B, C, D … for an option index. */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** The tone a verdict banner should take. Kept out of the component files so
 * they export nothing but components (react-refresh wants that). */
export function verdictTone(verdict: Verdict): 'neutral' | 'positive' | 'negative' {
  if (verdict === 'correct') return 'positive';
  if (verdict === 'incorrect') return 'negative';
  return 'neutral';
}

/** The sentence shown under a revealed question. */
export function verdictMessage(verdict: Verdict, correctIndex: number): string {
  switch (verdict) {
    case 'correct':
      return 'Correct. Well done.';
    case 'incorrect':
      return `Incorrect. The correct answer is ${optionLetter(correctIndex)}.`;
    case 'unkeyed':
      return 'Answer recorded. No answer key is available for this question yet.';
    case 'withheld':
      // Never "correct"/"incorrect": the client has no key to check against,
      // and inventing a verdict here is the whole failure this engine avoids.
      return 'Answer submitted. It was marked on the server.';
    case 'pending':
      return 'Answer recorded. It will be marked when you submit the paper.';
    case 'unanswered':
      return 'Not answered.';
  }
}
