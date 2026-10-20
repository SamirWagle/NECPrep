<div align="center">

<img src="frontend/public/favicon.svg" alt="NECPrep logo" width="80" height="80" />

# NECPrep

**Free, open-source exam preparation for Nepal Engineering Council (NEC) licence candidates.**

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/SamirWagle/EngineeringLisenseProject/pulls)

[Live app](https://lisensepreparation.samirwagle.com.np/) ·
[Report a bug](https://github.com/SamirWagle/EngineeringLisenseProject/issues/new/choose) ·
[Report a wrong answer](https://github.com/SamirWagle/EngineeringLisenseProject/issues/new/choose) ·
[Contributing](CONTRIBUTING.md)

</div>

---

## Contents

- [What this is](#what-this-is)
- [Current state](#current-state)
- [Screenshots](#screenshots)
- [Features](#features)
- [The question bank](#the-question-bank)
- [Known data defects and the quality gate](#known-data-defects-and-the-quality-gate)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Commands](#commands)
- [Performance budget](#performance-budget)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [Licence](#licence)

---

## What this is

A study app for the **Nepal Engineering Council licence examination** (Computer
Engineering). It serves a bank of multiple-choice questions organised by textbook
chapter, with chapter practice, timed mock tests, flashcards, bookmarks and
progress tracking.

> No account. Open the app, type a name, start practising. The name is stored in
> this browser and nothing is sent anywhere.

**Try it:** [lisensepreparation.samirwagle.com.np](https://lisensepreparation.samirwagle.com.np/)

### Who it is built for

A large share of users are on **entry-level Android handsets on 3G or metered
mobile data in Nepal**. That single fact drives most of the engineering decisions
in this repo: the app is static, works offline once loaded, splits every route
out of the initial download, and has a CI-enforced ceiling on how much JavaScript
it may ship before first render.

---

## Current state

Read this section before the feature list. The project is mid-rebuild and this
README is written to describe what the code does today, not what is planned.

| | |
|---|---|
| **Backend** | **None.** The app is entirely frontend. All questions are static JSON fetched from `/data/books/`. A Cloudflare Workers + D1 backend is in progress and is not yet in this repository. |
| **Accounts / authentication** | **None.** There is no sign-up, no login, no session, no password. The "login" on the landing page writes a display name to `localStorage` (`UserContext`, key `userName`) and nothing more. Every route under `/app` is publicly reachable. |
| **Data persistence** | Browser `localStorage` only. Progress, bookmarks, quiz history and in-progress mock drafts live in one browser and **cannot be recovered if cleared**. Settings offers an export to JSON. |
| **Question bank** | 10 book chapters, under active repair — see [below](#the-question-bank). A validator gates it in CI. 145 questions are currently quarantined and withheld from practice. |
| **Deployment** | Static build on Vercel (`frontend/vercel.json`). CI does not deploy; it only gates. |

---

## Screenshots

<div align="center">

| Landing page | Mock test detail |
|:---:|:---:|
| ![Landing](Screenshots/Screenshot%202026-03-05%20212111.png) | ![Mock test](Screenshots/Screenshot%202026-03-05%20212137.png) |

</div>

Captured 2026-03-05; the UI has moved on since. "Sign In" on the landing page
opens a name prompt — it stores a display name in this browser and does not
create an account.

---

## Features

| Feature | What it actually does |
|---|---|
| **Chapter practice** | Question-by-question practice from any of the 10 book chapters, with immediate feedback |
| **Quick practice** | A 10-question random set drawn across the bank |
| **Custom practice** | Pick chapters and a question count, get a quiz |
| **Mock tests** | Three timed configurations (10 per chapter / 45 min, a second 10-per-chapter set, and 5 per chapter / 20 min). Defined in `frontend/src/data/topics.ts`. Drafts survive a page reload |
| **Study hub** | Chapter-level syllabus and summary reading before practice |
| **Flashcards** | Flip-card recall over the chapter banks |
| **Bookmarks** | Flag any question and come back to it |
| **Progress** | Accuracy, questions attempted, and a per-chapter breakdown, computed from `localStorage` |
| **Settings** | Change display name, export all local data as JSON, reset all progress |
| **Deterministic option ordering** | Options are reordered before display to neutralise a severe answer-position bias in the authored data — [see below](#answer-position-bias) |
| **Works offline** | Static assets plus static JSON; once a chapter is loaded it needs no network |

### Not implemented, despite appearances

- **No theme switching.** The app is dark-only. A Dark Mode toggle previously
  shipped in Settings and controlled nothing; it has been removed rather than
  left as a lie.
- **No authentication, cloud sync, or leaderboard.** See
  [Current state](#current-state).

---

## The question bank

The bank lives in `frontend/public/data/books/` as `ch1.json` … `ch10.json` and
is fetched at runtime. There is **no** aggregated `all_questions.json` and no
`model-question.json`; earlier versions of this README documented both, and the
topic-based JSONs they summarised were deleted in commit `7ba0454`. The ten book
chapters are now the only question source, and they *are* the subject split.

**Snapshot measured 2026-10-20** with `node scripts/validate-questions.mjs`, while
deduplication of the bank was still in progress:

| File | Chapter | Rows |
|---|---|---:|
| `ch1.json` | Basic Electrical & Electronics | 525 |
| `ch2.json` | Digital Logic & Number Systems | 332 |
| `ch3.json` | C / C++ Programming | 391 |
| `ch4.json` | Computer Organization & Embedded Systems | 422 |
| `ch5.json` | Computer Networks & Security | 69 |
| `ch6.json` | Theory of Computation & Computer Graphics | 64 |
| `ch7.json` | DSA, DBMS and OS | 68 |
| `ch8.json` | Software Engineering and OOAD | 130 |
| `ch9.json` | AI & Machine Learning | 71 |
| `ch10.json` | Project Planning, Design and Implementation | 240 |
| | **Total rows** | **2,312** |
| | of which unique stems | 2,243 |
| | quarantined, not shown to students | 145 |

> **These numbers move.** The bank is being actively deduplicated and repaired, so
> treat the table as a dated snapshot, not a specification. For the current
> figures run `node scripts/validate-questions.mjs`. The counts the app displays
> come from `frontend/src/data/bookChapters.generated.ts`, which
> `scripts/sync-chapters.mjs` regenerates from the JSON on every dev start and
> every build — CI fails if that generated file is stale.

### Format

```json
{
  "qsns": "What is the time complexity of binary search on a sorted array?",
  "opt1": "O(n)",
  "opt2": "O(log n)",
  "opt3": "O(n log n)",
  "opt4": "O(1)",
  "correct_option": "O(log n)",
  "correct_option_index": 2
}
```

`correct_option_index` is **1-based**. Full reference, including every validation
rule and why it exists: **[`docs/question-format.md`](docs/question-format.md)**.

---

## Known data defects and the quality gate

Nothing had ever checked this data. `scripts/validate-questions.mjs` now does,
and it runs as a required CI job. What it found on first run:

| Defect | Count | Why it matters |
|---|---|---|
| `correct_option_index` disagreed with `correct_option`, and the text named by `correct_option` was **not among the four options at all** | 15 | The app trusts the index, so the student is told the right answer is wrong |
| `correct_option_index: 5` with only four options | 2 | Unanswerable — no selection can be correct |
| Two options with identical text | 7 | Two answers are simultaneously correct; only one is keyed |
| Duplicate question rows | 558 rows across 391 groups, **192 groups spanning `ch1` and `ch2`** | Inflated counts, repeats within one quiz, skewed statistics |
| Answer-position bias | option 2 correct in **32.0%** of the bank; **64.8%** of `ch9` | See below |

Questions that are provably unanswerable, and not yet repaired, are listed by id
in **`frontend/src/data/quarantine.json`** (145 entries as of 2026-10-20) and
filtered out by the loader so no student ever sees them.

The quarantine list exists for one reason: a gate that is permanently red is
useless for catching the *next* bad question. Known defects are logged as explicit,
reviewable decisions and excluded from the failure count, so any newly introduced
bad question fails the build on its own. It is a backlog to drain, not a place to
hide rows — removing an id without fixing the underlying question puts it straight
back in front of students and the validator will fail for it.

### Answer position bias

Across the bank, **option 2 was the correct answer in 32.0% of questions** against
a uniform 25%, with a chi-square of **158.2 on 3 degrees of freedom** (p < 0.001
begins at 16.27). Per chapter it was far worse: **64.8% in `ch9`**.

Options were never shuffled anywhere in the app, so **a student could score about
65% on chapter 9 by blind-guessing "option 2" without reading a single question.**
That makes the score meaningless as a readiness signal and trains positional
pattern-matching instead of engineering.

`orderOptions()` in `frontend/src/services/localData.ts` neutralises it:

- A uniform Fisher–Yates shuffle, **seeded from the question id**, so each question
  always presents in the same order. Determinism is required, not convenient:
  saved mock drafts and progress records store the chosen option *index*, and a
  permutation that varied between loads would silently re-point every stored
  answer. What is removed is the systematic correlation *across* the bank.
- **"All of the above" and similar options are pinned to the last slot** and
  excluded from the shuffle — moving one mid-list makes the question nonsense.
  There are 452 such options in the bank.

CI gates on the distribution **after** reordering: a chapter fails if any one slot
still holds the correct answer in 32% or more of its questions. The raw authored
skew is reported as a warning. Authors are still expected to vary the correct
position — the shuffle is a safety net, not a licence.

---

## Architecture

```
Browser
  │
  ├─ static assets (Vercel CDN)
  │     index.html → entry chunk + react / router / motion / vendor chunks
  │     route chunks, fetched on navigation (React.lazy)
  │
  ├─ fetch /data/books/chN.json          ← the question bank, static files
  │     └─ localData.ts: parse → 1-based index to 0-based
  │                      → orderOptions() deterministic reorder
  │                      → drop quarantined ids
  │                      → in-memory cache per chapter
  │
  └─ localStorage                         ← the only persistence layer
        userName, progress, bookmarks, quiz history, mock draft
```

Points worth knowing before changing anything:

- **`frontend/src/services/localData.ts` is the hinge of the app.** Question
  loading, 1-based-to-0-based index conversion, option reordering, quarantine
  filtering, the per-chapter cache, and every `localStorage` read and write go
  through it.
- **`orderOptions()` is duplicated in `scripts/validate-questions.mjs`** so the
  validator can measure the distribution a student actually sees. The two copies
  must change together or the CI gate measures something that is not what ships.
- **Only `Landing` is in the initial chunk.** Everything under `/app` is behind
  `React.lazy()` in `frontend/src/routes/AppRoutes.tsx`, so a visitor who never
  starts practising never downloads the app.
- **`bookChapters.generated.ts` is generated, not authored.** Edit
  `CHAPTER_META` in `scripts/sync-chapters.mjs` instead.
- **Question ids are `{topicId}_{arrayIndex}`** — for example `book-ch2_116`.
  They are positional, so reordering a chapter JSON invalidates every stored
  progress record and the entire quarantine list. Moving to content-hash ids is
  on the roadmap.

---

## Tech stack

| Layer | Technology |
|---|---|
| **Framework** | [React 19](https://react.dev) |
| **Language** | [TypeScript 5.9](https://www.typescriptlang.org), strict |
| **Build** | [Vite 7](https://vite.dev) |
| **Routing** | [React Router 7](https://reactrouter.com) |
| **Animation** | [Framer Motion](https://www.framer.com/motion/) |
| **Icons** | [Lucide React](https://lucide.dev) |
| **Styling** | Hand-written CSS (`src/index.css`, `src/App.css`, per-page CSS) |
| **Tests** | [Vitest](https://vitest.dev) + [Testing Library](https://testing-library.com) under jsdom |
| **Lint** | ESLint 9 flat config + typescript-eslint |
| **Persistence** | Browser `localStorage`. No server, no database, no SDK |
| **Hosting** | [Vercel](https://vercel.com), static output |

There is **no 3D/WebGL layer**: Three.js, `@react-three/fiber`, `@react-three/drei`
and the `ThreeBackground` component were removed — a WebGL canvas was a poor trade
on the low-end Android hardware this app targets. There is **no Firebase and no
Supabase**; neither is a dependency and neither is imported anywhere. (`frontend/.env.example`
still mentions Supabase keys; nothing reads them.)

---

## Getting started

Requires **Node 20+** and npm 9+.

```bash
git clone https://github.com/SamirWagle/EngineeringLisenseProject.git
cd EngineeringLisenseProject/frontend
npm install
npm run dev          # http://localhost:5173
```

`npm run dev` first runs `scripts/sync-chapters.mjs` to regenerate
`src/data/bookChapters.generated.ts` from the chapter JSONs, then starts Vite.

No environment variables are needed. There is no backend to run.

---

## Commands

Run from `frontend/` unless noted:

| Command | What it does |
|---|---|
| `npm run dev` | Sync chapter manifest, then start the dev server |
| `npm run build` | Sync manifest → `tsc -b` → `eslint .` → `vite build` into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npx tsc -b` | Type check only (project references; emits nothing) |
| `npm run lint` | ESLint |
| `npm run test` / `npx vitest run` | Unit tests, once |
| `npm run test:watch` | Unit tests in watch mode |

From the **repo root**:

| Command | What it does |
|---|---|
| `node scripts/validate-questions.mjs` | Question-bank quality gate. Exits 1 on data errors. Add `--json`, `--csv out.csv`, or `--strict` to fail on warnings too |
| `node scripts/sync-chapters.mjs` | Regenerate `bookChapters.generated.ts` from the chapter JSONs |
| `node .github/scripts/bundle-budget.mjs` | Measure initial-load JS against the 180 kB gzipped budget (needs a build in `frontend/dist/`) |

### What CI gates

`.github/workflows/ci.yml` runs on every pull request and every push to `main`.
Before it existed there was no automated check of any kind on this repository,
which is how 15 ESLint errors reached `main`.

**`Question bank`** — `scripts/validate-questions.mjs`. Gates malformed JSON,
missing or mistyped fields, empty stems and options, `correct_option_index` out of
range, the two answer fields disagreeing, duplicate option text, and
answer-position bias after reordering. Needs no `npm install`, so it answers in
seconds.

**`Frontend`** — `npm ci`, `npx tsc -b`, `npm run lint`, `npx vitest run`,
`npm run build`, the initial-load JS budget, and a check that
`bookChapters.generated.ts` is not stale.

CI does not deploy. Deployment is a separate, later decision.

---

## Performance budget

CI **fails** if initial-load JavaScript exceeds **180 kB gzipped**.

"Initial-load" is exactly the entry `<script type="module">` in `dist/index.html`
plus every `<link rel="modulepreload">` Vite emits beside it — the static import
graph of the entry. Route chunks behind `React.lazy()` are excluded, which is what
makes the budget affordable.

Measured 2026-10-20 with `node .github/scripts/bundle-budget.mjs` against a local
production build:

| Chunk | raw | gzip |
|---|---:|---:|
| `react` | 192.35 kB | 60.29 kB |
| `motion` | 115.37 kB | 37.82 kB |
| `router` | 36.32 kB | 13.12 kB |
| `index` (app entry) | 18.83 kB | 6.33 kB |
| `vendor` | 2.23 kB | 1.14 kB |
| `registerSW` | 0.13 kB | 0.13 kB |
| **Total** | **365.23 kB** | **118.81 kB** |

That is **66% of budget**, leaving about 61 kB of headroom. Render-blocking CSS
sits outside the JS budget but is reported alongside it (16.51 kB gzipped in the
same build). Run the script yourself for current figures — it prints the live
numbers and the CI job writes the same table into the run summary.

The budget is not decoration. On a 400 kbit/s effective link, every 50 kB of
gzipped JavaScript is roughly another second before anything is interactive —
before the phone has even parsed it. Vendor code is split per package in
`vite.config.ts` so an app deploy does not invalidate the framework in users'
caches.

---

## Project structure

```
.
├── .github/
│   ├── workflows/ci.yml                 # the two CI jobs
│   ├── scripts/bundle-budget.mjs        # initial-load JS budget check
│   ├── ISSUE_TEMPLATE/                  # bug, feature, question error
│   └── pull_request_template.md
├── docs/
│   └── question-format.md               # question format + every validation rule
├── scripts/
│   ├── sync-chapters.mjs                # chapter JSONs → bookChapters.generated.ts
│   └── validate-questions.mjs           # question bank quality gate
├── CONTRIBUTING.md
└── frontend/
    ├── public/
    │   ├── favicon.svg
    │   └── data/books/ch1.json … ch10.json      # the question bank
    ├── src/
    │   ├── main.tsx, App.tsx
    │   ├── routes/AppRoutes.tsx         # all routes; everything under /app is lazy
    │   ├── layout/AppShell.tsx          # sidebar + <Outlet/>
    │   ├── context/
    │   │   ├── UserContext.tsx          # display name in localStorage
    │   │   └── user-context.ts
    │   ├── services/
    │   │   ├── localData.ts             # loading, option ordering, localStorage
    │   │   └── __tests__/
    │   ├── data/
    │   │   ├── bookChapters.generated.ts   # GENERATED — do not edit
    │   │   ├── topics.ts                # Topic/MockTest types + mock test config
    │   │   ├── syllabus.ts
    │   │   ├── quarantine.ts            # typed accessor over the list
    │   │   ├── quarantine.json          # ids withheld from practice
    │   │   └── duplicate-triage.json    # duplicate-group triage notes
    │   ├── hooks/useChapters.ts
    │   ├── pages/
    │   │   ├── Landing.tsx              # the only eager page
    │   │   └── app/                     # Dashboard, PracticeHub, TopicPractice,
    │   │                                # ChapterPracticeSelector, QuickPractice,
    │   │                                # CustomPractice, MockTests, MockTestDetail,
    │   │                                # MockTestQuiz, StudyHub, TopicStudy,
    │   │                                # Flashcards, Bookmarks, Progress,
    │   │                                # Profile, Settings, BookPractice
    │   └── test/setup.ts
    ├── eslint.config.js, vite.config.ts, vitest.config.ts
    └── vercel.json
```

There is no `src/pages/auth/` directory, and no authentication code of any kind.

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, the commands CI runs, code
standards, and the PR process. For question data, read
**[`docs/question-format.md`](docs/question-format.md)** first — the single most
common mistake is treating `correct_option_index` as 0-based, and it is the one
error the validator cannot always catch.

The highest-value contributions right now:

- **Verified answer corrections** for the questions in
  `frontend/src/data/quarantine.json`. Each needs the correct answer worked out
  from source material; a correction with a citation can be applied directly.
- **Duplicate triage** against `frontend/src/data/duplicate-triage.json`.
- **Explanations** for questions. The bank has answers but no reasoning.
- **Accessibility and small-screen fixes.** Design target is a 360px viewport on
  a low-end Android device.

Use the issue templates. For a wrong answer, use **Question error report** and
quote the option *text* — options are reordered per question, so "option B"
identifies nothing.

---

## Roadmap

Ordered roughly by priority.

- [ ] Drain the quarantine backlog: verify and fix every withheld question
- [ ] Finish deduplicating the bank, then enforce uniqueness as a CI error
- [ ] Content-hash question ids, replacing the positional `{topicId}_{index}` form
      that ties progress records and the quarantine list to array order
- [ ] Cloudflare Workers + D1 backend: real accounts and cross-device progress
- [ ] Per-question explanations and solution notes
- [ ] PWA / service worker for genuine offline installs
- [ ] Spaced repetition for flashcards
- [ ] Nepali language support (i18n)
- [ ] Past exam papers as dedicated mock sets

[Open a feature request](https://github.com/SamirWagle/EngineeringLisenseProject/issues/new/choose)
if something you need is not here.

---

## Acknowledgements

- **[Samir Wagle](https://github.com/SamirWagle)** — creator and maintainer
- **[React](https://react.dev)**, **[Vite](https://vite.dev)**,
  **[React Router](https://reactrouter.com)**,
  **[Framer Motion](https://www.framer.com/motion/)**,
  **[Vitest](https://vitest.dev)** — the libraries this is built on
- Every NEC licence candidate who reported a wrong answer. Those reports are the
  reason the question bank now has a validator.

---

## Licence

MIT. See [LICENSE](LICENSE).

<div align="center">

Made by [Samir Wagle](https://github.com/SamirWagle) for every engineer working toward their NEC licence.

**If NECPrep helped you study, a star genuinely helps others find it.**

[![GitHub stars](https://img.shields.io/github/stars/SamirWagle/EngineeringLisenseProject?style=social)](https://github.com/SamirWagle/EngineeringLisenseProject/stargazers)

</div>
