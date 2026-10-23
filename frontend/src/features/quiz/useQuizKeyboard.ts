/**
 * useQuizKeyboard — keyboard shortcuts for an active quiz.
 *
 * The app shipped the quiz as mouse/touch only (three onKeyDown handlers in the
 * whole codebase), which makes a 100-question mock a hand exercise. Bindings:
 *
 *   1-4 / a-d   select that option
 *   Enter       submit the current question, then advance on the next press
 *   ArrowLeft   previous question
 *   ArrowRight  next question
 *   f           toggle flag-for-review
 *   b           toggle bookmark
 *
 * Deliberately inert when:
 *  - focus sits in a text field or a contenteditable region (otherwise typing
 *    "bad" in a search box would flag, select and bookmark a question);
 *  - a modifier is held, so Cmd-1 / Ctrl-F still belong to the browser;
 *  - Enter arrives on a button or link, where the native activation already
 *    does the right thing and ours would double-fire.
 */

import { useEffect, useRef } from 'react';

export interface QuizKeyboardHandlers {
  /** Zero-based option index. */
  onSelectOption: (optionIndex: number) => void;
  onSubmitOrAdvance: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleFlag: () => void;
  onToggleBookmark: () => void;
}

export interface UseQuizKeyboardOptions extends QuizKeyboardHandlers {
  /** Number of options on the current question; out-of-range keys are ignored. */
  optionCount: number;
  /** False while loading, on the results screen, or in a modal. Default true. */
  enabled?: boolean;
}

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
]);

/**
 * True when typing should win over shortcuts.
 *
 * Exported because it is the part worth testing directly, and because every
 * future global shortcut in this app needs the same guard.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target instanceof HTMLInputElement) {
    // Checkboxes and radios are not text entry, so shortcuts stay live there.
    return TEXT_INPUT_TYPES.has(target.type);
  }
  return false;
}

function isNativelyActivated(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY';
}

/** Maps a key to an option index, or -1. Supports digits 1-9 and letters a-i. */
export function optionIndexForKey(key: string): number {
  if (key.length !== 1) return -1;
  const code = key.charCodeAt(0);
  if (code >= 0x31 && code <= 0x39) return code - 0x31; // "1".."9"
  const lower = key.toLowerCase().charCodeAt(0);
  if (lower >= 0x61 && lower <= 0x69) return lower - 0x61; // "a".."i"
  return -1;
}

export function useQuizKeyboard(options: UseQuizKeyboardOptions): void {
  const { optionCount, enabled = true } = options;

  // One listener for the life of the quiz; the latest handlers are read through
  // a ref so re-binding on every render cannot drop a keystroke.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextEntryTarget(event.target)) return;

      const handlers = latest.current;

      switch (event.key) {
        case 'Enter':
          if (isNativelyActivated(event.target)) return;
          event.preventDefault();
          handlers.onSubmitOrAdvance();
          return;
        case 'ArrowLeft':
          event.preventDefault();
          handlers.onPrev();
          return;
        case 'ArrowRight':
          event.preventDefault();
          handlers.onNext();
          return;
        default:
          break;
      }

      if (event.shiftKey) return;

      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        handlers.onToggleFlag();
        return;
      }
      if (event.key === 'b' || event.key === 'B') {
        event.preventDefault();
        handlers.onToggleBookmark();
        return;
      }

      // Letter shortcuts for options start at "a", so "b" is both bookmark and
      // option 2. Bookmark wins; option 2 keeps its digit. Checked after the
      // named keys above for exactly that reason.
      const optionIndex = optionIndexForKey(event.key);
      if (optionIndex >= 0 && optionIndex < optionCount) {
        event.preventDefault();
        handlers.onSelectOption(optionIndex);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, optionCount]);
}
