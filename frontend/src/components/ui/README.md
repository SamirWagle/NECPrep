# UI primitives

Accessible, dependency-light building blocks. Import from the barrel:

```tsx
import { Button, Dialog, RadioGroup, Radio } from '@/components/ui';
// or, in this repo's current setup:
import { Button, Dialog, RadioGroup, Radio } from '../components/ui';
```

## What every primitive guarantees

| Guarantee | How |
| --- | --- |
| Visible focus indicator | `:focus-visible { outline: 2px solid var(--color-ring) }` with a 2px offset on every focusable element. Never `outline: none`. |
| Minimum 44x44px target | `min-height: 44px` on all interactive primitives at every size; icon-only buttons also get `min-width: 44px`. Size variants change padding and type scale, never the floor. (WCAG 2.5.5) |
| Reduced motion | Every animation and transition is disabled or de-emphasised under `@media (prefers-reduced-motion: reduce)`. Spinners swap rotation for an opacity pulse so "busy" is still conveyed. |
| `className` passthrough | Merged **after** the component's own classes, so consumer rules win at equal specificity. |
| Forwarded ref | Every component is a `forwardRef` onto the real DOM element. |
| Styling | CSS Modules reading `var(--color-…)` / `var(--radius-…)` / `var(--shadow-…)` / `var(--duration-…)` tokens, each with a hard-coded fallback so the components render correctly even before the token layer lands. No Tailwind utility classes are assumed. |
| Colour is never the only signal | State is always paired with a glyph and/or visually hidden text (WCAG 1.4.1). |

Zero runtime dependencies beyond `react`, `react-dom` and `lucide-react` (icons only).

### A note on `disabled`

Across this folder, "unavailable" is expressed as `aria-disabled` rather than the
`disabled` attribute wherever the control still needs to be **readable**. A
`disabled` element is removed from the tab order and, in several
browser/screen-reader combinations, effectively from the accessibility tree.
`Button` is the exception: an explicitly `disabled` Button really is `disabled`,
because that is what callers expect from a form control. Even there, `loading`
uses `aria-disabled` + `aria-busy` so focus is not thrown to `<body>` mid-request.

---

## Button

```tsx
<Button variant="primary" size="md" loading={saving} leadingIcon={<Save size={16} />}>
  Save attempt
</Button>

<Button iconOnly aria-label="Bookmark question">
  <Bookmark size={18} />
</Button>
```

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'danger'` | `'primary'` | |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | All sizes keep the 44px floor. |
| `loading` | `boolean` | `false` | `aria-busy` + `aria-disabled`, spinner replaces `leadingIcon`, clicks swallowed, **stays focusable**. |
| `loadingLabel` | `string` | — | Visually hidden text appended while loading. |
| `iconOnly` | `boolean` | `false` | Square 44x44 target. **Requires `aria-label`.** |
| `fullWidth` | `boolean` | `false` | |
| `leadingIcon` / `trailingIcon` | `ReactNode` | — | Wrapped in a flex span. |
| `disabled` | `boolean` | `false` | Real `disabled` attribute. |

**a11y guarantees** — native `<button type="button">`, so Space and Enter
activation come from the platform. `loading` never removes the button from the
tab order. The type system rejects an icon-only button with no accessible name:

```tsx
<Button iconOnly><X /></Button>
// ✗ Property ''aria-label'' is missing in type ... but required in type
//   '{ iconOnly: true; 'aria-label': string; }'
```

## IconButton

```tsx
<IconButton aria-label="Close dialog" icon={<X size={18} />} variant="ghost" />
```

Thin wrapper over `Button` in icon-only mode. `icon` and `aria-label` are both
required props, so the 44x44 target and the accessible name cannot be forgotten
at the call site.

## RadioGroup + Radio

The full WAI-ARIA [radiogroup](https://www.w3.org/WAI/ARIA/apg/patterns/radio/)
pattern. This is the one to reach for for quiz options.

```tsx
<RadioGroup
  aria-label="Answer options"
  value={selected}
  onValueChange={setSelected}
  readOnly={submitted}
>
  {options.map((option, index) => (
    <Radio
      key={option.id}
      value={option.id}
      state={
        !submitted ? undefined
        : index === correctIndex ? 'correct'
        : option.id === selected ? 'incorrect'
        : 'neutral'
      }
    >
      {option.text}
    </Radio>
  ))}
</RadioGroup>
```

### RadioGroup props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `value` | `string \| null` | — | Controlled. `null` = nothing chosen. |
| `defaultValue` | `string \| null` | `null` | Uncontrolled. |
| `onValueChange` | `(value: string) => void` | — | Fires for clicks and arrow-key selection. |
| `readOnly` | `boolean` | `false` | Review mode — see below. |
| `disabled` | `boolean` | `false` | Whole group inert, via `aria-disabled`. |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | Sets `aria-orientation`. Both axes of arrow key work either way. |
| `name` | `string` | — | Emits a hidden input for form submission. |
| `required` | `boolean` | `false` | Sets `aria-required`. |
| `aria-label` **or** `aria-labelledby` | `string` | — | **One is required by the type system.** |

### Radio props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `value` | `string` | — | Required. Mirrored to `data-value` for navigation. |
| `state` | `'neutral' \| 'selected' \| 'correct' \| 'incorrect'` | derived | Defaults to `selected` when checked, else `neutral`. |
| `stateLabel` | `string \| null` | `'Correct answer'` / `'Incorrect answer'` | Visually hidden text so the revealed state is **announced**, not colour-only. `null` suppresses. |
| `description` | `ReactNode` | — | Secondary line. |
| `disabled` | `boolean` | `false` | This option only, via `aria-disabled`. |
| `showIndicator` | `boolean` | `true` | The leading bullet/tick/cross. |

### Keyboard interactions

| Key | Behaviour |
| --- | --- |
| `Tab` / `Shift+Tab` | Enters or leaves the group as **one single tab stop**. |
| `↓` / `→` | Move focus to the next option (wrapping) **and select it**. |
| `↑` / `←` | Move focus to the previous option (wrapping) **and select it**. |
| `Home` | Move focus to the first option and select it. |
| `End` | Move focus to the last option and select it. |
| `Space` / `Enter` | Select the focused option without moving focus (native button activation). |
| Any arrow + `Ctrl`/`Alt`/`Meta` | Ignored, so browser and screen-reader shortcuts keep working. |

Typeahead is deliberately not implemented — it is not part of the radiogroup pattern.

**Roving tabindex.** Exactly one option is tabbable at any moment: the selected
one, or the first option when nothing is selected yet. Options always *render*
`tabIndex={-1}` — a constant, so React never patches the attribute after mount —
and a layout effect on the group owns the single `0`. Option order comes from a
DOM query, so arrow-key order always matches visual order even when options are
wrapped, reordered or conditionally rendered.

**`readOnly` (post-answer review).** Selection is locked, but:

- options keep `aria-disabled`, **never** the `disabled` attribute, so the
  revealed correct answer stays in the accessibility tree;
- every option stays focusable and reachable with the arrow keys and `Home`/`End`;
- the group is marked `aria-readonly="true"`;
- `correct` / `incorrect` carry visually hidden text, so the outcome does not
  depend on seeing green and red;
- the tab stop stays on the locked answer.

## Dialog

WAI-ARIA modal dialog, rendered through a portal.

```tsx
<Dialog
  open={open}
  onClose={() => setOpen(false)}
  title="What should we call you?"
  description="Only used to personalise your report."
  initialFocusRef={inputRef}
  footer={<Button onClick={save}>Save</Button>}
>
  <input ref={inputRef} aria-label="Your name" />
</Dialog>
```

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `open` | `boolean` | — | Returns `null` when false; nothing is mounted. |
| `onClose` | `() => void` | — | Escape, backdrop and close button. |
| `title` | `ReactNode` | — | Rendered as an `<h2>` and wired via `aria-labelledby`. |
| `description` | `ReactNode` | — | Wired via `aria-describedby`. |
| `footer` | `ReactNode` | — | Right-aligned action row. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | |
| `initialFocusRef` | `RefObject<HTMLElement \| null>` | — | Defaults to the first tabbable node. |
| `closeOnEscape` | `boolean` | `true` | |
| `closeOnBackdropClick` | `boolean` | `true` | |
| `showCloseButton` | `boolean` | `true` | |
| `closeLabel` | `string` | `'Close dialog'` | |
| `container` | `HTMLElement \| null` | `document.body` | Portal host. |

### Keyboard interactions

| Key | Behaviour |
| --- | --- |
| `Escape` | Closes (document-level capture listener, so it works even if focus has drifted). |
| `Tab` | Moves through the dialog's tabbable nodes; from the **last** one it wraps to the first. |
| `Shift+Tab` | Moves backwards; from the **first** one it wraps to the last. |
| `Tab` with focus outside the panel | Pulled back to the first tabbable node. |
| `Tab` with nothing tabbable inside | Focus is pinned on the panel itself. |

**a11y guarantees** — `role="dialog"` + `aria-modal="true"`, named by its title.
On open: the previously focused element is recorded, body scroll is locked
(reference-counted, so stacked overlays behave), and focus moves inside. On
close: scroll unlocks and focus returns to the element that opened the dialog —
checked with `isConnected` so a removed trigger does not throw. Backdrop
dismissal is split across `mousedown` (records that the press started on the
backdrop, and `preventDefault()`s the default body-focus) and `click`, so a text
selection dragged out of the panel does not dismiss, and the restored focus is
not immediately blurred.

## Switch

```tsx
<Switch checked={darkMode} onCheckedChange={setDarkMode}>Dark mode</Switch>
<Switch aria-label="Timer" defaultChecked />
```

| Prop | Type | Default |
| --- | --- | --- |
| `checked` / `defaultChecked` | `boolean` | `false` |
| `onCheckedChange` | `(checked: boolean) => void` | — |
| `size` | `'sm' \| 'md'` | `'md'` |
| `disabled` | `boolean` | `false` |
| `children` | `ReactNode` | — |

**a11y guarantees** — real `role="switch"` with `aria-checked` on a native
`<button>`. **Space** activation comes from the platform (a `<button>` does not
scroll the page on Space); **Enter** is wired explicitly with `preventDefault()`
so it cannot double-toggle. Tested for exactly one toggle per press on both
keys. The type system requires either visible `children` or an ARIA label.
`disabled` uses `aria-disabled`, keeping the control focusable and its state
announceable.

## Tabs

```tsx
<Tabs defaultValue="all">
  <TabList aria-label="Bookmark filters">
    <Tab value="all">All</Tab>
    <Tab value="flagged">Flagged</Tab>
  </TabList>
  <TabPanel value="all">…</TabPanel>
  <TabPanel value="flagged">…</TabPanel>
</Tabs>
```

| Component | Props |
| --- | --- |
| `Tabs` | `value` + `onValueChange` (controlled) **or** `defaultValue` (uncontrolled) — one is required by the type system; `orientation` (`'horizontal'`), `activationMode` (`'automatic' \| 'manual'`, default `automatic`). |
| `TabList` | `aria-label` **or** `aria-labelledby` — one required. |
| `Tab` | `value` (required), `disabled`. |
| `TabPanel` | `value` (required), `keepMounted` (default `false`). |

### Keyboard interactions

| Key | Behaviour |
| --- | --- |
| `→` / `←` (horizontal) or `↓` / `↑` (vertical) | Move focus to the next/previous enabled tab, wrapping. In `automatic` mode this also selects it. |
| `Home` / `End` | First / last enabled tab. |
| `Space` / `Enter` | Selects the focused tab (needed in `manual` mode). |
| `Tab` | Leaves the tablist and lands on the active panel. |

**a11y guarantees** — `role="tablist"` (with `aria-orientation`) / `role="tab"`
(with `aria-selected` and `aria-controls`) / `role="tabpanel"` (with
`aria-labelledby`), ids generated with `useId` and slugified from the tab value.
Roving tabindex makes the whole tablist one tab stop. The panel carries
`tabIndex={0}` so keyboard users reach non-focusable panel content. Disabled
tabs use `aria-disabled` and are skipped by the arrow keys. The strip scrolls
horizontally with `scroll-snap-type: x proximity` and a hidden scrollbar, and
the newly focused tab is scrolled into view.

## ProgressBar / ProgressRing

```tsx
<ProgressBar label="Chapter progress" value={12} max={40} hint="12 / 40" />
<ProgressRing aria-label="Mock test score" value={82}>82%</ProgressRing>
```

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `value` | `number` | `0` | |
| `min` / `max` | `number` | `0` / `100` | |
| `indeterminate` | `boolean` | `false` | Drops `aria-valuenow`, which is how AT recognises an indeterminate bar. |
| `valueText` | `string` | `"42%"` or `"12 of 40"` | The accessible text alternative (`aria-valuetext`). |
| `tone` | `'accent' \| 'success' \| 'warning' \| 'danger' \| 'info'` | `'accent'` | |
| `label` / `hint` (bar) | `ReactNode` | — | Visible label row; `label` also names the bar. |
| `thickness` | `number` | `8` (bar) / `6` (ring) | px |
| `size` (ring) | `number` | `56` | px diameter |
| `children` (ring) | `ReactNode` | — | Centre content, rendered `aria-hidden`. |

**a11y guarantees** — `role="progressbar"` with `aria-valuenow`/`-valuemin`/
`-valuemax`/`-valuetext`. A name is required by the type system: visible `label`
text (bar) or an ARIA label. Out-of-range values are clamped visually rather
than overflowing the track. Fill elements are not labelled, since `progressbar`
is "children presentational" in ARIA.

## Toast + useToast

```tsx
<ToastProvider duration={5000} placement="topRight">
  <App />
</ToastProvider>

const { toast, dismiss, dismissAll } = useToast();
toast({ title: 'Attempt saved', description: 'Synced to your profile', tone: 'success' });
```

| `ToastProvider` prop | Type | Default |
| --- | --- | --- |
| `placement` | `'topRight' \| 'topCenter' \| 'bottomRight' \| 'bottomCenter'` | `'topRight'` |
| `duration` | `number` (ms, `0` = sticky) | `5000` |
| `max` | `number` | `4` |
| `dismissLabel` | `string` | `'Dismiss notification'` |
| `container` | `HTMLElement \| null` | `document.body` |

| `toast(options)` | Type | Notes |
| --- | --- | --- |
| `title` / `description` | `ReactNode` | |
| `tone` | `'neutral' \| 'success' \| 'warning' \| 'danger' \| 'info'` | |
| `duration` | `number` | Overrides the provider default. `0` = sticky. |
| `action` | `ReactNode` | Usually a `Button`. |
| `politeness` | `'polite' \| 'assertive'` | `polite` by default; `assertive` only for blocking errors. |

**a11y guarantees** — two live regions (`role="status"` / `aria-live="polite"`
and `role="alert"` / `aria-live="assertive"`) are kept **permanently mounted**,
because a live region has to exist before content is inserted into it or the
insertion is not announced. Auto-dismiss pauses while the toast is hovered *or*
while focus is anywhere inside it, and resumes with the unspent time banked
(WCAG 2.2.1 Timing Adjustable) — so a toast with an action never disappears
mid-reach. The viewport is `pointer-events: none` with `pointer-events: auto`
on each toast, so it never blocks the page beneath. `useToast()` throws outside
a provider rather than silently swallowing notifications.

## Badge / Card / Skeleton / Spinner / EmptyState / Separator / VisuallyHidden

| Component | Key props | a11y notes |
| --- | --- | --- |
| `Badge` | `tone`, `size`, `icon`, `srPrefix` | Static text, never interactive. `srPrefix` adds the context that colour or position would otherwise imply (e.g. `"Status:"`). `icon` is `aria-hidden`. |
| `Card` | `padding`, `variant`, `interactive` | `interactive` adds hover/focus affordance **styling only** — it does not make a `<div>` keyboard reachable. Render a real `<button>`/`<a>`, or put a focusable control inside. |
| `Skeleton` | `variant`, `width`, `height`, `lines` | Always `aria-hidden`: a shimmering box means nothing to a screen reader, and a dozen of them is noise. Announce loading once on the owning region. Shimmer stops under reduced motion. |
| `Spinner` | `size`, `thickness`, `label` | With `label` it is a `role="status"` live region; without, it is `aria-hidden` and decorative (correct when a parent already carries `aria-busy`). Rotation becomes an opacity pulse under reduced motion. |
| `EmptyState` | `icon`, `title`, `description`, `action`, `headingLevel`, `compact` | Renders a real heading (`h2`–`h5` via `headingLevel`, default `3`) so it appears in heading navigation. Pick the level that fits the surrounding outline — skipping levels breaks it. |
| `Separator` | `orientation`, `decorative`, `label` | `decorative` (default `true`) renders `role="none"` so it adds no meaningless screen-reader stop; `decorative={false}` renders `role="separator"` with `aria-orientation`. A `label` forces a meaningful separator. |
| `VisuallyHidden` | — | Clip-path recipe: off-screen visually, present in the accessibility tree and in copied text. |

## Helpers

`cx(...classes)` — class joiner. `getFocusableElements(root)` — tabbable
descendants in document order (deliberately not `offsetParent`-based, so it
works under jsdom). `lockBodyScroll()` / `unlockBodyScroll()` —
reference-counted scroll lock. `useComposedRef(forwardedRef, localRef)` — keep
an internal ref while honouring a forwarded one. `tabId` / `tabPanelId` — the
id scheme used to wire tabs to panels.

## Tests

`__tests__/RadioGroup.test.tsx`, `__tests__/Dialog.test.tsx` and
`__tests__/primitives.test.tsx` — 65 tests, run with `npx vitest run src/components/ui`.
The RadioGroup and Dialog suites exist because those two patterns fail
*silently*: a missing roving tabindex or a broken focus trap looks completely
fine on screen.
