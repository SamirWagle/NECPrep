# Contributing to NECPrep

NECPrep is a free study platform for people sitting the Nepal Engineering
Council licence exam. Two facts about its users shape almost every rule below:

- **A wrong answer key is the worst bug this project can ship.** It does not
  throw an error, it teaches the wrong thing to someone preparing for a
  licensing exam, and they have no way to tell.
- **Most of the audience is on entry-level Android handsets on mobile data in
  Nepal.** Payload is a feature. CI enforces a hard budget on it.

Everything else is ordinary open-source contribution.

---

## Getting set up

Requires **Node 20+** and npm 9+.

```bash
git clone https://github.com/SamirWagle/EngineeringLisenseProject.git
cd EngineeringLisenseProject/frontend
npm install
npm run dev          # http://localhost:5173
```

`npm run dev` first runs `scripts/sync-chapters.mjs`, which regenerates
`frontend/src/data/bookChapters.generated.ts` from the chapter JSONs in
`frontend/public/data/books/`.

There is no backend to run and no environment variables to set. The app fetches
static JSON and keeps all state in `localStorage`.

## The commands CI runs

Run these before you open a PR. They are exactly the checks that gate it.

```bash
cd frontend
npx tsc -b           # type check (project references; emits nothing)
npm run lint         # ESLint
npx vitest run       # unit tests, jsdom
npm run build        # sync-chapters + tsc + eslint + vite build

# from the repo root
node .github/scripts/bundle-budget.mjs     # initial-load JS budget
node scripts/validate-questions.mjs        # question bank quality gate
```

`npm run test:watch` runs Vitest in watch mode while you work.

The question-bank validator needs no `node_modules` at all — it imports only
`node:` builtins — so you can run it from a clean checkout.

## What CI gates

Two jobs, in `.github/workflows/ci.yml`:

**`Question bank`** — runs `scripts/validate-questions.mjs`. Fails on answer keys
that contradict themselves, indices pointing past the last option, identical
option text, missing or mistyped fields, malformed JSON, and answer-position bias
measured after the loader's option reordering. No install step, so it answers in
seconds. Full reference: [`docs/question-format.md`](docs/question-format.md).

**`Frontend`** — type check, lint, unit tests, production build, initial-load JS
budget, and a check that `bookChapters.generated.ts` is not stale.

Both must pass. If a check is failing for a reason you believe is wrong, say so
in the PR — do not add a suppression to get to green.

### The bundle budget

`.github/scripts/bundle-budget.mjs` fails the build if the JavaScript needed
before first render exceeds **180 kB gzipped**.

"Initial-load" means precisely the entry `<script type="module">` in
`dist/index.html` plus every `<link rel="modulepreload">` Vite emits beside it —
the static import graph of the entry. Route chunks behind `React.lazy()` are
excluded, which is what makes the budget affordable.

Measured 2026-10-20: **365.23 kB raw / 118.81 kB gzipped**, about 66% of budget.
`react` alone is 60.29 kB gzipped of that and `framer-motion` another 37.82 kB.
Render-blocking CSS sits outside the JS budget and is reported alongside it. Run
the script for current numbers; the `Frontend` CI job writes the same table into
its run summary.

If you need a new dependency:

1. Check whether it can load behind a route with `React.lazy()`, or on demand.
2. Check its gzipped cost — run the budget script before and after.
3. If it must be in the initial load and pushes past the budget, that is a
   conversation in the PR, not a number to edit. The budget lives in the
   workflow and is changed deliberately, with a reason recorded.

## Code standards

- **TypeScript, strict.** No `any`, no `@ts-ignore`, no `@ts-expect-error`
  without a comment explaining why it is unavoidable.
- **No new `eslint-disable`.** The absence of CI is how 15 ESLint errors reached
  `main`; the fix is not to silence them.
- **Do not weaken a check to pass it.** Deleting an assertion, skipping a test,
  or raising a threshold to get green is a change to the project's quality bar
  and needs to be argued for explicitly, not slipped into a diff.
- **Keep refactors and behaviour changes in separate commits.** A reviewer
  should be able to see which lines change what the app does.
- Conventional Commits for messages: `feat:`, `fix:`, `refactor:`, `docs:`,
  `test:`, `chore:`.
- Tests go in `__tests__/` next to the code, named `*.test.ts(x)`.

### Accessibility and small screens

Design for a 360px-wide viewport first. Keyboard navigation and visible focus
states are requirements, not polish — a meaningful share of users are on cheap
devices with unreliable touch digitisers.

## Working on question data

**Read [`docs/question-format.md`](docs/question-format.md) first.** It documents
the `{qsns, opt1..opt4, correct_option, correct_option_index}` format, the fact
that `correct_option_index` is **1-based**, every failure mode the validator
catches with worked examples from real defects in this bank, the answer-position
bias and how the loader neutralises it, and the quarantine list.

The short version:

- `correct_option_index` is 1-based. `1` is `opt1`, `4` is `opt4`.
- `correct_option` must be the full text of the option at that index,
  character-for-character.
- No two options in a question may have the same text.
- Search the existing bank for your stem before adding it. The bank has a
  substantial duplicate backlog and PRs should not add to it.
- Vary which slot the correct answer sits in. Roughly a quarter in each.
- Never write "both (a) and (c)" or refer to an option by letter or number.
  Options are reordered before display, so such references are broken by
  construction.
- `node scripts/validate-questions.mjs` must exit 0.

Questions that are provably broken and not yet fixed are listed in
`frontend/src/data/quarantine.json` and withheld from practice. Removing an id
from that list without fixing the underlying row puts a broken question back in
front of students.

## Reporting a problem with a question

Use the **Question error report** issue template. Quote the question text exactly
and quote the correct option's *text*, not its letter or number — options are
reordered per question, so "option B" means nothing to anyone else.

A correction with a source (textbook section, formula, past paper) can be applied
directly. One without needs independent verification first, so it takes much
longer.

## Pull requests

1. Branch from `main`. One change per branch.
2. Stage the files you changed by name. Avoid `git add -A`.
3. Run the commands above.
4. Open the PR. The template has three required sections — **what changed and
   why**, **how it was tested**, and **explain the diff in your own words**.
   Write all three yourself. The third exists to show the diff is understood,
   which is the thing a reviewer most needs and the thing a generated summary
   cannot provide.
5. "Tested" names the command you ran and shows its output. "Fixed" shows the
   failing run before and the passing run after.

For UI changes, include a screenshot at 360px wide.

## Project layout

```
.
├── .github/
│   ├── workflows/ci.yml            # the two CI jobs
│   └── scripts/bundle-budget.mjs   # initial-load JS budget check
├── docs/question-format.md         # question bank format and validation reference
├── scripts/
│   ├── sync-chapters.mjs           # chapter JSONs -> bookChapters.generated.ts
│   └── validate-questions.mjs      # question bank quality gate
└── frontend/
    ├── public/data/books/ch1..ch10.json   # the question bank
    └── src/
        ├── routes/AppRoutes.tsx    # all routes; everything under /app is lazy
        ├── services/localData.ts   # question loading, option ordering, localStorage
        ├── data/                   # chapter manifest, topics, quarantine list
        ├── hooks/useChapters.ts
        ├── layout/AppShell.tsx
        └── pages/                  # Landing.tsx + pages/app/*
```

## Licence

By contributing you agree your work is distributed under the project's
[MIT licence](LICENSE).
