<!--
Three sections, all required. Write them yourself — the point of the third one
is to prove the diff is understood, which a generated summary cannot do.
Delete these comments before submitting.
-->

## What changed and why

<!--
What this PR does, and the problem it solves. Link the issue if there is one
(`Closes #123`). If it changes behaviour a student will notice, say what they
will see.
-->

## How it was tested

<!--
Name the commands you ran and what they said. "Tested" without a command is not
tested.

    cd frontend
    npx tsc -b
    npm run lint
    npx vitest run
    npm run build
    node ../.github/scripts/bundle-budget.mjs

And, for any change touching frontend/public/data/books/ or the question loader:

    node scripts/validate-questions.mjs

Paste the relevant output. For a UI change, a screenshot at a narrow viewport
(360px wide) is worth more than one at desktop width.
-->

## Explain the diff in your own words

<!--
Walk through the change file by file: what each edit does and why that approach
rather than the obvious alternative. Call out anything you are unsure about, and
anything a reviewer should look at hardest.
-->

---

### Checklist

- [ ] `npx tsc -b`, `npm run lint`, `npx vitest run` and `npm run build` all pass locally
- [ ] `node scripts/validate-questions.mjs` passes — required if this touches question data or the loader
- [ ] Initial-load JS is still within budget (the `Frontend` CI job prints the number)
- [ ] No new `eslint-disable`, `@ts-ignore`, `@ts-expect-error` or skipped test; if there is one, the PR explains why
- [ ] `frontend/src/data/bookChapters.generated.ts` is regenerated and committed, if chapter JSONs changed
- [ ] The README and `docs/` still describe what the code actually does

### If this changes question data

- [ ] Every row has `correct_option_index` **1-based** and `correct_option` matching the text at that index exactly
- [ ] No duplicate option text within a question, and no duplicate stems against the existing bank
- [ ] The correct answer is not always in the same position — see `docs/question-format.md`
- [ ] Any ids removed from `frontend/src/data/quarantine.json` have had their underlying rows actually fixed
