# The question bank format

Every practice question in NECPrep comes from a JSON file in
`frontend/public/data/books/`, one file per book chapter, `ch1.json` through
`ch10.json`. The files are fetched at runtime by the browser — there is no
build step that transforms them and no database behind them, so whatever is in
these files is exactly what a student is shown.

That is why this document is long. A wrong answer key here does not produce an
error message; it silently teaches the wrong thing to someone sitting a
licensing exam.

Before you add or change anything in these files, read [The answer key](#the-answer-key)
and [Answer position](#answer-position-bias). Those are the two places where the
existing bank went wrong at scale.

---

## The shape

Each file is a **JSON array of question objects**. No wrapper object, no
metadata, no trailing commas.

```json
[
  {
    "qsns": "What is the time complexity of binary search on a sorted array?",
    "opt1": "O(n)",
    "opt2": "O(log n)",
    "opt3": "O(n log n)",
    "opt4": "O(1)",
    "correct_option": "O(log n)",
    "correct_option_index": 2
  }
]
```

### Fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `qsns` | string | yes | The question stem, as shown to the student. Non-empty after trimming. |
| `opt1` | string | yes | First answer option. Non-empty after trimming. |
| `opt2` | string | yes | Second answer option. |
| `opt3` | string | yes | Third answer option. |
| `opt4` | string | yes | Fourth answer option. |
| `correct_option` | string | yes | The **full text** of the correct option, character-for-character identical to the `optN` it refers to. |
| `correct_option_index` | integer | yes | Which option is correct, **1-based**: `1` means `opt1`, `4` means `opt4`. |

All seven fields must be present on every row. There are no optional fields and
no extra fields are read — anything else you add is ignored by the app, so do not
rely on it.

### `correct_option_index` is 1-based

This is the single most important sentence in this document, and the easiest
thing to get wrong.

```json
{ "correct_option_index": 1 }   // opt1 is correct
{ "correct_option_index": 2 }   // opt2 is correct
{ "correct_option_index": 3 }   // opt3 is correct
{ "correct_option_index": 4 }   // opt4 is correct
{ "correct_option_index": 0 }   // INVALID — not a question, no answer
{ "correct_option_index": 5 }   // INVALID — there is no opt5
```

The app converts it internally: `frontend/src/services/localData.ts` does
`correctIndex = q.correct_option_index - 1` to get a 0-based array position. If
you author 0-based indices, every question in your file will be marked one
option too early and **the validator will not always catch it** — an off-by-one
that happens to produce a self-consistent pair of `correct_option_index` and
`correct_option` is indistinguishable from a deliberate answer. This is the one
failure mode that only human review catches, which is why it is called out here
rather than buried in the error table.

### The two answer fields must agree

`correct_option` and `correct_option_index` are redundant on purpose: each one
checks the other. The app **trusts the index** and ignores `correct_option`
entirely at runtime. `correct_option` exists so that a disagreement between the
two is detectable, and the validator treats any disagreement as a build-breaking
error.

So: set the index to the slot you mean, and copy the option text into
`correct_option` verbatim. Do not paraphrase it, do not strip punctuation, do
not fix its capitalisation in one place and not the other.

---

## Validation

```bash
node scripts/validate-questions.mjs              # human-readable report
node scripts/validate-questions.mjs --json       # full machine-readable output
node scripts/validate-questions.mjs --csv t.csv  # triage spreadsheet
node scripts/validate-questions.mjs --strict     # also fail on warnings
```

Exit codes: `0` clean, `1` errors found, `2` could not run (no data directory,
no JSON files).

This runs in CI as the **Question bank** job on every pull request and every push
to `main`. It needs no `npm install`, so it reports in seconds. If it exits
non-zero, the PR does not merge.

**Errors block the build. Warnings do not**, unless you pass `--strict`. The
split is not about severity of principle but about whether a machine can be
certain: an error means the row is provably broken, a warning means it is
probably worth a human look.

---

## Failure modes: errors

Each of these makes a question either unanswerable or mis-graded. The worked
examples are real rows from this bank, found the first time the validator was
run against it.

### `KEY_CONFLICT` — the two answer fields disagree

`correct_option_index` points at one option and `correct_option` names different
text.

**Why it matters.** The app trusts the index. If the index is the wrong one, the
student is told the right answer is wrong and the wrong answer is right. There is
no way for them to tell; they will go and re-learn the material to fit the lie.

**What was found.** 15 rows in this condition, and in all 15 the text named by
`correct_option` was **not among the four options at all** — so the conflict
could not be resolved by trusting either field. Every one had to be withheld and
re-derived by hand. Examples:

```jsonc
// ch2.json — a binary conversion question
{
  "opt1": "110100", "opt2": "110010", "opt3": "110110", "opt4": "111000",
  "correct_option": "110100",
  "correct_option_index": 3        // index 3 is "110110", not "110100"
}
```

```jsonc
// ch1.json — a cutoff-frequency question
{
  "opt4": "1.59 kHz",
  "correct_option": "1.59 Hz",     // kHz vs Hz: a factor of 1000
  "correct_option_index": 4
}
```

```jsonc
// ch2.json — an 8-bit range question
{
  "opt2": "0 to 256",
  "correct_option": "0 to 255",    // the correct answer, but it is not an option
  "correct_option_index": 2
}
```

That last one is the instructive case. `0 to 255` is the right answer to the
question and `0 to 256` is wrong, so the defect is not in the key — it is in
`opt2`. A conflict tells you something is wrong; it does not tell you which field
is wrong. That takes subject knowledge, which is why these cannot be auto-fixed.

**How to fix.** Work out the correct answer from the material. Then set `optN` to
that text, set `correct_option_index` to `N`, and set `correct_option` to the
same string.

### `INDEX_RANGE` — the index points past the last option

`correct_option_index` is less than 1 or greater than 4.

**Why it matters.** There are only four options. An index of `5` resolves to
`undefined`; the student cannot select the correct answer because it does not
exist. Whatever they pick, they are marked wrong.

**What was found.** 2 rows with `"correct_option_index": 5` and only four
options. Almost certainly authored in a spreadsheet where a fifth column existed
and was later dropped.

```jsonc
// ch2.json
{
  "opt1": "…", "opt2": "…", "opt3": "…", "opt4": "…",
  "correct_option_index": 5        // unanswerable
}
```

A `0` here is the same defect wearing a different hat: it is what you get from
authoring 0-based indices, and it is the reason the validator rejects `0` rather
than quietly accepting it as "opt1".

### `OPTION_DUPLICATE` — two options have identical text

Compared case-insensitively and after trimming whitespace.

**Why it matters.** Two options that read the same are either both correct or
both wrong. Only one is keyed, so a student who picks the other one is marked
wrong for giving the identical answer. It is also a reliable sign that an option
was meant to be different and got lost in copy-paste — so the question is
usually missing a real distractor too.

**What was found.** 7 rows. One had two separate collisions:

```jsonc
// ch3.json — array-of-structs declaration syntax
{
  "opt1": "struct *array_name[size];",
  "opt2": "struct (*array_name)[size];",
  "opt3": "struct *array_name[size];",    // same as opt1
  "opt4": "struct (*array_name)[size];",  // same as opt2
  "correct_option_index": 2
}
```

Four options, two distinct answers. Whichever is keyed, half the students who
know the answer are marked wrong.

```jsonc
// ch1.json — a resonant-frequency question
{ "opt3": "159.15 Hz", "opt4": "159.15 Hz" }
```

**How to fix.** Replace the duplicate with a genuine distractor — a plausible
wrong answer, ideally one that corresponds to a specific mistake a student might
make (wrong unit, dropped factor of 2π, transposed digits).

### `MISSING_FIELD`, `OPTION_TYPE`, `OPTION_EMPTY`, `STEM_EMPTY`, `INDEX_TYPE`

Structural checks. A field is absent, an option is a number or `null` instead of
a string, an option or the stem is blank, or `correct_option_index` is not an
integer (a string `"2"` fails here, and so does `2.0` written as `2.5`).

**Why they matter.** These are the defects that make the app render blank buttons
or `undefined`. They are cheap to catch and have no legitimate exception.

### `PARSE`, `SHAPE`

The file is not valid JSON, or its top level is not an array.

**Why they matter.** A single trailing comma takes a whole chapter offline for
every user, and the app's loader catches the exception and returns an empty
array — so the chapter silently shows zero questions rather than erroring
visibly. This check is the only thing standing between a stray comma and a dead
chapter.

### `ANSWER_POSITION_BIAS` — the correct answer is still clustered after reordering

See [Answer position](#answer-position-bias) below, which this check exists to
enforce.

---

## Failure modes: warnings

These do not block the build. They are judgement calls, or they describe a
condition the app already compensates for.

### `DUPLICATE_STEM` — the same question appears more than once

Stems are compared after normalising: lowercased, runs of whitespace collapsed,
and all punctuation except `?` removed. So `"What is an embedded system?"` and
`"What is an Embedded System ?"` are the same stem.

**Why it matters.** Duplicates distort everything built on top of the bank. A
chapter's advertised question count is inflated. A "random 10 questions" quiz can
serve the same question twice in one sitting. Accuracy statistics
over-weight whatever the duplicated question happens to test. And a student
revising feels they are making progress through new material when they are
re-answering rows they have already seen.

**What was found.** 558 redundant rows across 391 duplicate groups — and 192 of
those groups spanned `ch1.json` and `ch2.json`, meaning a large block of
questions had been pasted into both chapters. Deduplication is in progress; run
the validator for the current figure.

It is a warning rather than an error for one reason: the validator cannot know
whether two identically-worded stems are a copy-paste accident or two legitimate
variants with different options and different answers. A human has to look. The
triage notes for this bank's groups are in
`frontend/src/data/duplicate-triage.json`.

**How to avoid it.** Before adding questions, search the existing bank for the
stem. A duplicate that arrives in a PR is far cheaper to reject than one that has
to be found later among thousands of rows.

### `POSITIONAL_NOT_LAST` — "All of the above" is not in `opt4`

Options matching `all|none|both (of) (the) above|these|mentioned`.

**Why it matters.** These options only make sense in the final slot. "All of the
above" sitting in `opt2` refers to one option. The app pins them last when it
reorders (see below), so this is cosmetic in effect — but an option in the wrong
slot usually means the row was assembled by hand and deserves a second look.

### `KEY_MISSING_TEXT` — `correct_option` is empty

Only the index identifies the answer, so the cross-check that would catch an
off-by-one is gone. The row still works; it is just unguarded.

### `STEM_TRUNCATED` — the stem ends in `...` or `…`

**Why it matters.** The question is probably cut off mid-sentence, usually from a
spreadsheet column that clipped. A student cannot answer `"…the capitalized
value of the property is..."` because they were never told the rest.

### `STEM_SHORT` — the stem is under 15 characters

**Why it matters.** Stems like `"CPM is"` or `"A thread is:"` are fragments. They
are answerable by someone who recognises the topic, but they test recall of a
definition rather than understanding, and they are frequently the visible end of
a truncated row.

### `ANSWER_POSITION_SKEW_AS_AUTHORED`

Reported per chapter when the authored distribution of correct positions is
non-uniform at p < 0.001 (chi-square above 16.27 on 3 degrees of freedom, with at
least 30 questions). It is a warning because the loader neutralises it — see
below.

---

## Answer position bias

This is the defect in the bank that mattered most and was hardest to see.

### What was measured

Across the whole bank, **option 2 was the correct answer in 32.0% of questions**,
against the 25% a uniform distribution would give. Chi-square was **158.2 on 3
degrees of freedom** — the p < 0.001 critical value is 16.27, so this is not
close to chance.

Per chapter it was far worse. In `ch9.json`, **option 2 was correct in 64.8% of
questions**.

### Why that is a serious defect, not a cosmetic one

A student who notices the pattern — and students do notice patterns, that is
most of what exam preparation trains — **could score about 65% on chapter 9 by
blind-guessing "option 2" without reading a single question.**

That breaks the app in both directions. The score is meaningless as a signal of
readiness, so the student walks into the real exam believing they know chapter 9.
And the practice itself becomes actively harmful: the most rewarded behaviour is
pattern-matching on position, so that is the skill being trained instead of the
engineering.

The bias was invisible because options were never shuffled anywhere in the app.
Each question presented in exactly the authored order, every time, for every
user.

### What the app does about it

`orderOptions()` in `frontend/src/services/localData.ts` reorders every
question's options before they are shown:

- The permutation is a uniform **Fisher–Yates shuffle**, not a
  `sort(() => Math.random() - 0.5)` comparator — that trick is not a uniform
  shuffle and its output depends on the sort implementation.
- It is **seeded from the question id** (FNV-1a hash into a mulberry32 PRNG), so
  it is deterministic: a given question always presents in the same order. This
  is required, not merely convenient — saved mock-test drafts and progress
  records store the chosen option *index*, so a permutation that varied between
  page loads would silently re-point every answer a student had already saved.
  What is being removed is the systematic correlation *across* the bank, not
  per-question unpredictability.
- **"All of the above"-style options are pinned to the last slot** and excluded
  from the shuffle. Moving one into the middle of the list makes the question
  nonsense. There are 452 such options in the current bank and nearly all of them
  were authored in slot 4.
- If fewer than two options are free to move, the order is left alone.

The same function is reimplemented inside `scripts/validate-questions.mjs` so the
validator measures the distribution a student actually experiences. **The two
implementations must stay in step** — if you change `orderOptions()`, change the
copy in the validator in the same commit, or the gate starts measuring something
that is not what ships.

### What CI gates on

The `ANSWER_POSITION_BIAS` **error** fires when, *after* reordering, any single
slot holds the correct answer in **32% or more** of a chapter's questions, for
chapters with at least 100 questions. Quarantined rows are excluded, since they
never reach a student.

The `ANSWER_POSITION_SKEW_AS_AUTHORED` **warning** reports the raw, pre-reordering
skew.

The gate is on the post-reordering number deliberately. Gating on the authored
distribution would be permanently red and would demand re-authoring thousands of
existing questions to fix something the loader already handles. Gating on what is
shown catches the case that actually harms a student — including the case where
new questions are so skewed that the shuffle cannot absorb them.

### What authors must still do

**Vary the position of the correct answer in what you author.** Do not rely on
the loader.

- The shuffle is seeded and therefore fixed. It breaks the bank-wide
  correlation, but it is not a licence to put every answer in slot 2 and let the
  code sort it out — feed it a 65% skew in a small chapter and the result can
  still come out skewed, which is exactly what the CI error catches.
- A chapter authored with every answer in one slot is a strong signal the
  questions were generated rather than drawn from source material, and generated
  questions in this bank have a markedly higher defect rate.
- Options are reordered before display, so **never refer to an option by its
  letter or number** in a stem, a distractor, or an explanation. "Both (a) and
  (c)" is broken by the shuffle. Spell out the content instead.

Aim for roughly a quarter of correct answers in each of the four slots across
any batch you contribute.

---

## Quarantine

Some rows in the bank are provably broken and have not yet been fixed. Rather
than let the gate sit permanently red — where it would be useless for catching
the *next* bad question — those rows are listed explicitly in
`frontend/src/data/quarantine.json`:

```json
[
  {
    "id": "book-ch2_116",
    "codes": ["INDEX_RANGE"],
    "notes": ["correct_option_index is 5 but there are only 4 options - this question is unanswerable"]
  }
]
```

Two things follow from being on that list:

1. **The loader filters the question out**, so it is never shown to a student.
   See `quarantinedIds` in `frontend/src/data/quarantine.ts`.
2. **The validator reports its findings separately** and does not count them as
   build-breaking errors. A *newly introduced* bad question is not on the list,
   so it still fails the build.

The ids are the synthetic `{topicId}_{arrayIndex}` form — `book-ch2_116` is index
116 of `ch2.json`. **These ids are tied to array position**, so reordering,
inserting into, or deduplicating a chapter JSON invalidates the whole list and
must be accompanied by regenerating it. This fragility is one of the reasons the
bank is moving to content-hash ids.

**Quarantine is a backlog, not a resting place.** To clear an entry: fix the row
in `frontend/public/data/books/`, re-run the validator, confirm the row no longer
produces a finding, and remove its id from `quarantine.json` in the same commit.
Removing an id without fixing the row puts a broken question straight back in
front of students, and the validator will fail the build for it — which is the
intended behaviour.

---

## Adding a new chapter

1. Add `chN.json` to `frontend/public/data/books/`, in the format above.
2. Run `node scripts/sync-chapters.mjs` from the repo root. It regenerates
   `frontend/src/data/bookChapters.generated.ts` with the chapter's title, colour,
   icon and question count. **Commit the regenerated file** — CI fails if it is
   stale, because the counts shown in the app would otherwise disagree with the
   JSON on disk.
3. Run `node scripts/validate-questions.mjs` and fix every error.
4. Open a PR. Fill in the question-data section of the checklist.

## Contributing a batch of questions

The owner of this project supplies new question JSON in the shape above. Before
it is merged:

```bash
# from the repo root
node scripts/validate-questions.mjs                      # must exit 0
node scripts/validate-questions.mjs --csv triage.csv     # spreadsheet of findings
node scripts/validate-questions.mjs --json | less         # full detail
```

A batch is ready when the validator exits 0, the duplicate-stem warnings are
either empty or individually justified, and the correct answer is spread across
all four positions.
