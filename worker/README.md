# NECPrep API — Cloudflare Worker + D1

The backend for NECPrep. Why D1 and not Supabase:
[`docs/adr/0001-cloudflare-d1-over-supabase.md`](../docs/adr/0001-cloudflare-d1-over-supabase.md).

```
worker/
  wrangler.toml            Worker + D1 bindings, vars, cron triggers
  migrations/              THE SCHEMA. Source of truth. Applied in order.
  db/
    schema.ts              Drizzle definitions — typed client, NOT a DDL generator
    apply.mjs              apply every migration to a local SQLite file
    verify-schema.mjs      prove schema.ts and migrations/*.sql agree
    smoke.mjs              exercise the schema the way the API will
    measure.mjs            measure bytes/row and derive the D1 ceiling
    seed/
      import-questions.mjs       load the 10 chapter JSONs into the bank
      generate-reference-sql.mjs regenerate 0007 from the frontend syllabus files
  src/                     API handlers — owned separately, not by the schema
```

## Quick start

```bash
cd worker
npm install
npm run db:check     # apply + seed + verify + smoke + typecheck, from scratch
```

`db:check` must pass before any schema change is proposed. It is the whole
contract in one command:

| step | what it proves |
|---|---|
| `db:apply:local` | all 7 migrations apply in order, FKs on, integrity clean |
| `db:seed:local` | the question bank imports; no published question lacks an answer key |
| `db:verify` | `db/schema.ts` and `migrations/*.sql` describe the same database |
| `db:smoke` | 59 assertions: grading, rollups, permutation, archival safety |
| `db:typecheck` | `db/schema.ts` compiles under `--strict` |

Against wrangler's own D1 runner (Miniflare, no network, no account):

```bash
npm run d1:migrate:local
```

Last verified run: 7 migrations applied, **28 tables + 1 view + 1 FTS5 virtual
table, 65 indexes, 11 triggers**, 1 subject, 10 chapters, 60 subchapters,
3 mock templates; seed wrote **2,290 questions / 9,160 options / 2,289 answer
keys / 125 errata reports**; 59/59 smoke assertions pass; 308 columns,
65 indexes, 49 foreign keys and 35 enums verified identical between SQL and TS.

## The one rule

> **`question_answer_keys` is server-only. It must not appear in any query
> whose result can reach a client before that client's attempt is submitted.**

D1 has no row-level security — SQLite has none — so this cannot be a database
rule. It is enforced structurally instead:

- `questions` has **no** correct-answer column.
- `question_options` has **no** `is_correct` column.
- The key exists **only** in `question_answer_keys`, one row per question.
- `v_question_delivery` is what the delivery path reads. It cannot reference
  the key table, so `SELECT *` over it is safe by construction.

So leaking the key requires naming `question_answer_keys` in a `FROM` clause —
a grep-able, reviewable, testable event. These are the only three queries
allowed to do it. Copy them; do not improvise them.

**NQ-10 grade-one** — an answer submitted mid-attempt. The response carries a
boolean, never the key:

```sql
SELECT correct_option_id
  FROM question_answer_keys
 WHERE question_id = ?1;
```

**NQ-10b grade-batch** — attempt submit. One statement for the whole paper,
because D1 allows 50 queries per Worker invocation and a 100-question mock
graded one at a time would need 100:

```sql
SELECT question_id, correct_option_id
  FROM question_answer_keys
 WHERE question_id IN (SELECT value FROM json_each(?1));
```

**NQ-10c review-after-submit** — the only client-visible path, and only for an
attempt that belongs to the caller and is already submitted. The `EXISTS`
clause *is* the authorization; on a database with RLS it would be a policy, so
here it must be in the query, every time:

```sql
SELECT aa.question_id, aa.selected_option_id, k.correct_option_id
  FROM attempt_answers aa
  JOIN question_answer_keys k ON k.question_id = aa.question_id
 WHERE aa.attempt_id = ?1
   AND EXISTS (SELECT 1 FROM attempts a
                WHERE a.id = ?1 AND a.user_id = ?2
                  AND a.status = 'submitted');
```

The API's test suite should assert that **no** response body on a pre-submit
route ever contains an option id that is not in the delivered paper.

### Why that is not enough on its own, and what closes the gap

The question bank shipped as public JSON under `frontend/public/data/books/`
and is in git history permanently. Anyone can reconstruct "question X's answer
is the second option". Hiding the key server-side therefore only solves half
the problem.

The other half is **per-attempt option permutation**:

- `attempt_questions.option_order` is a JSON array of **option ids** in the
  order that attempt showed them. It is the server-side mapping between what
  the student saw and what the database knows, and it is the only copy that
  counts — the client's is a convenience.
- `attempts.option_seed` reproduces the exact paper for a dispute, without
  trusting the client's copy.
- `attempt_answers` stores `selected_ordinal` (the stable authored slot) and
  exposes `selected_option_id` as a VIRTUAL generated column, so an answer
  references a stable option id at zero storage cost. `delivered_position`
  records where the option sat on screen and is analytics only — never the
  grading key.
- Options flagged `question_options.is_pinned` must stay last. All 450 "All of
  the above"-style options in the bank were authored in slot 4, and shuffling
  one into the middle makes the question nonsense.

**Do not deliver raw option ids to the browser.** `q_abc123#3` leaks the
authored slot, and a client that matches a delivered stem against the public
JSON could then grade the paper offline whatever order the options arrived in.
Deliver each option as its **index into this attempt's `option_order`** (or an
HMAC of the option id under `option_seed`), accept that handle back, and
resolve it to an ordinal server-side through `option_order`. The client then
holds nothing that reveals authored position.

Be precise about what this does and does not buy. For the 2,290 questions
already published as JSON, the key is **irrecoverably public** — any client
that can read a stem can look the answer up by text, and no server-side
measure changes that. What the design does protect: no question authored from
now on ever has its key exposed, and a delivered paper cannot be graded by
position alone. The full argument is in the second block of
`0004_assessment.sql`.

Permutation also fixes a live fairness problem. Across the 2,190 published
questions the authored correct option sits at slot 1/2/3/4 in 634/721/496/339 —
32.9% at slot 2 against the 25% a fair bank would show, and worse per chapter.
Unpermuted, a student can score well above chance by learning the tell.

## Schema map

| migration | tables |
|---|---|
| `0001_identity` | `users`, `user_profiles`, `sessions`, `admin_audit_log` |
| `0002_content` | `subjects`, `chapters`, `subchapters`, `questions`, `question_options`, `question_answer_keys`, `v_question_delivery`, `explanations`, `tags`, `question_tags`, `question_reports`, `content_versions` |
| `0003_search` | `questions_fts` (FTS5) + 6 maintenance triggers |
| `0004_assessment` | `mock_test_templates`, `attempts`, `attempt_questions`, `attempt_answers`, `attempt_answers_archive` |
| `0005_learning` | `bookmarks`, `srs_state`, `study_sessions`, `streaks`, `user_question_stats` + 5 rollup triggers |
| `0006_engagement` | `leaderboard_snapshots`, `leaderboard_entries`, `notifications` |
| `0007_reference_data` | the 1 subject, 10 chapters, 60 NEC syllabus codes, 3 mock templates |

### Row-count expectations

Bounded unless stated otherwise. "per user" is per *active* user.

| table | growth | at 1,000 MAU | at 10,000 MAU |
|---|---|---|---|
| `users`, `user_profiles`, `streaks` | 1 per user | ~1 k each | ~10 k each |
| `sessions` | 1–3 per user, swept | ~3 k | ~30 k |
| `subjects` / `chapters` / `subchapters` | reference | 1 / 10 / 60 | same |
| `questions` | editorial | 2,290 | 10 k–50 k |
| `question_options` | ~4 per question | 9,160 | 40 k–200 k |
| `question_answer_keys` | 1 per question | 2,289 | = questions |
| `explanations` | 0–3 per question | → 2 k | → 50 k |
| `tags` / `question_tags` | editorial | ~200 / ~8 k | ~500 / ~150 k |
| `question_reports` | errata | 125 (seeded) | ~5 k |
| `content_versions` | 1 per edit | ~5 k | ~100 k |
| `mock_test_templates` | reference | 3 | ~20 |
| `attempts` | ~10/user/month | ~120 k/yr | ~1.2 M/yr |
| `attempt_questions` | ~25 per attempt | ~3 M/yr | ~30 M/yr |
| **`attempt_answers`** | **unbounded — see archival** | **1.5 M live @ 90 d** | **15 M live @ 90 d** |
| `bookmarks` | ~20 per user | ~20 k | ~200 k |
| `srs_state` | 1 per (user, studied question) | ~300 k | ~3 M |
| `study_sessions` | ~30/user/month | ~360 k/yr | ~3.6 M/yr |
| `user_question_stats` | 1 per (user, seen question) | ~400 k | ~4 M |
| `leaderboard_snapshots` / `_entries` | pruned to 30 days | ~400 / ~390 k | ~400 / ~3.9 M |
| `notifications` | expiring | ~50 k | ~500 k |
| `admin_audit_log` | privileged actions | ~2 k | ~20 k |

`attempt_questions` deserves a note: it is bounded per attempt (one row per
delivered question) but attempts accumulate, so at 10,000 MAU it is the
*second* table to watch. It is far narrower than `attempt_answers` and is what
makes a submitted attempt reviewable after archival has removed the raw
answers, so it has a longer retention than they do — but it is not infinite,
and the same batched-delete pattern applies.

### The unbounded table and the archival plan

Measured, not estimated (`npm run db:measure`, SQLite 3.54, 4 KB pages, all
three indexes present, rollup triggers live):

```
attempt_answers (table b-tree)         42.7 bytes/row
uq_attempt_answers_attempt_question    33.1
idx_attempt_answers_answered_at        25.7
idx_attempt_answers_question_correct   30.9
                                      ------
TOTAL                                 132.4 bytes/row      68% of it index
```

Rest of the schema with the bank seeded: **5.1 MB** (1.0 MB of that is FTS5).
So a 500 MB free D1 database holds **3,918,960** answer rows; a 10 GB paid one
holds 81,043,612.

| MAU | rows/month | row-writes/day | 90 d live | 180 d live | fits free 500 MB @ 90 d |
|---|---|---|---|---|---|
| 1,000 | 500 k | 66,667 | 1.5 M / 189 MB | 3.0 M / 379 MB | yes |
| 2,000 | 1.0 M | 133,333 | 3.0 M / 379 MB | 6.0 M / 758 MB | yes |
| 5,000 | 2.5 M | 333,333 | 7.5 M / 947 MB | 15 M / 1.85 GB | no |
| 10,000 | 5.0 M | 666,667 | 15 M / 1.85 GB | 30 M / 3.70 GB | no |
| 25,000 | 12.5 M | 1,666,667 | 37.5 M / 4.62 GB | 75 M / 9.25 GB | no |

**The write cap binds before the storage cap.** D1 counts index rows as writes,
so one answer is four row writes; the free plan's 100,000 row-writes-per-day
allowance saturates around 1,500 MAU, while storage would tolerate 2,500.

**Retention policy**

- answers on a submitted attempt: **90 days** free / 180 paid
  (`ANSWER_RETENTION_DAYS` in `wrangler.toml`)
- answers on an abandoned or expired attempt: **7 days**
- the `attempts` summary row: kept indefinitely (one row per sitting, ~120 B)

**Why deleting is enough.** D1 exposes no `VACUUM`, so a delete does not shrink
the file — but it frees the page for reuse. With a fixed retention window the
live set is bounded, the file grows to about that size and then stays there.
Without the job it grows forever and the first symptom is writes failing at the
500 MB wall.

**What is safe to delete.** Nothing user-visible depends on a raw answer row
older than the review window: per-attempt score and counts live on `attempts`,
per-question history on `user_question_stats`, scheduling on `srs_state`, and
leaderboards are precomputed — all trigger- or cron-maintained. Deleting raw
answers loses the question-by-question review of an *old* attempt and nothing
else.

**There is deliberately no `DELETE` trigger on `attempt_answers`.** Archival
deletes millions of rows; a delete trigger that decremented the rollups would
erase every student's entire progress history the first night the job ran.
`db/smoke.mjs` asserts the trigger's absence.

**The job** (nightly cron, batched because D1 allows 50 queries per invocation
and one unbounded `DELETE` would blow both the per-query time limit and the
daily write budget):

```sql
-- 1. stage, denormalising user_id because the attempt may be gone later.
INSERT INTO attempt_answers_archive (id, attempt_id, user_id, question_id,
                                     selected_ordinal, is_correct,
                                     delivered_position, time_ms, answered_at)
SELECT aa.id, aa.attempt_id, a.user_id, aa.question_id, aa.selected_ordinal,
       aa.is_correct, aa.delivered_position, aa.time_ms, aa.answered_at
  FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
 WHERE aa.answered_at < unixepoch('now', '-90 days')
   AND aa.id > ?1                       -- cursor, 0 on the first page
 ORDER BY aa.id
 LIMIT 5000;

-- 2. drain to R2 as NDJSON, then stamp r2_object_key. THIS is the step that
--    makes the archive an archive; the staging table is in the same database
--    and frees no space on its own.

-- 3. delete exactly the id range just staged.
DELETE FROM attempt_answers
 WHERE id BETWEEN ?1 AND ?2
   AND answered_at < unixepoch('now', '-90 days');

-- 4. the short window for attempts nobody finished.
DELETE FROM attempt_answers
 WHERE attempt_id IN (SELECT id FROM attempts
                       WHERE status IN ('abandoned', 'expired')
                         AND started_at < unixepoch('now', '-7 days')
                       LIMIT 200);
```

After a large purge, compact the FTS index — it is the only compaction D1
offers and it is cheap:

```sql
INSERT INTO questions_fts (questions_fts, rank) VALUES ('merge', -64);
```

## Named queries

Every index in `migrations/` carries the `NQ-nn` it exists to serve, in a
comment directly above it. An index with no named query is a write-amplifier
with no reader; at 132 bytes/row on the hot table that is not a rounding error.

The full text of each query lives next to its index. Index of names:

| NQ | name | table |
|---|---|---|
| 01–04c | session lookup/sweep/revoke, login by email, profile by handle | `sessions`, `users`, `user_profiles` |
| 05–06b | subject/chapter/subchapter lists and lookups | `subjects`, `chapters`, `subchapters` |
| **07** | **practice-draw** (the hottest query on the platform) | `questions` |
| 08 | practice-draw by subchapter | `questions` |
| 09 | deliver-options | `question_options` |
| **10 / 10b / 10c** | **grade-one / grade-batch / review-after-submit** | `question_answer_keys` |
| 11–11d | question search, admin search, index rebuild, index compact | `questions_fts` |
| 12 / 12b | explanation for question / review queue | `explanations` |
| 13–14 | tags for question / questions for tag | `question_tags` |
| 15–17 | report triage queue, reports for question, report dedupe | `question_reports` |
| 18 / 18b | content history, contributor activity | `content_versions` |
| 19–19b | template by slug, template list, blueprint expand | `mock_test_templates` |
| 20–22b | resume attempt, attempt by public id, history, expire stale | `attempts` |
| 23 / 23b | attempt paper, render paper | `attempt_questions` |
| 24–26d | answer load/upsert, archival scan, difficulty recompute, archive drain | `attempt_answers` |
| **27** | **progress-page — one covering index scan, ten groups** | `user_question_stats` |
| 27b / 27c | progress by subchapter, re-chapter stats | `user_question_stats` |
| 28 | weak-areas queue | `user_question_stats` |
| 29 / 29b | SRS due queue, workload forecast | `srs_state` |
| 30 / 30b | bookmarks list, by folder | `bookmarks` |
| 31–31c | study history, activity heatmap, open session | `study_sessions` |
| 32a / 32b | streak touch (idempotent upsert), streak leaderboard source | `streaks` |
| 33–35d | leaderboard page, my rank, latest snapshot, prune | `leaderboard_*` |
| 36–36d | unread notifications, history, dedupe, prune | `notifications` |
| 37a–37c | audit by actor / by entity / recent | `admin_audit_log` |
| 38 / 38b | moderation queue, unclassified queue | `questions` |
| 39 / 40 | legacy-id lookup (migration only), import dedupe | `questions` |

Two to internalise:

**NQ-07 practice-draw.** Partial on `status = 'published'`, with `id`
trailing so the index is covering — the draw never touches the table, and the
index physically cannot return an unpublished question.

```sql
SELECT id FROM questions
 WHERE chapter_id = ?1 AND status = 'published'
 ORDER BY ... LIMIT ?2;
```

**NQ-27 progress-page.** One index range scan, ten groups, no join, no temp
b-tree (asserted by `db/smoke.mjs` via `EXPLAIN QUERY PLAN`). `chapter_id` is
denormalised onto `user_question_stats` by the rollup trigger specifically so
this needs no join, and it keeps working after archival deletes the answer log.

```sql
SELECT chapter_id,
       COUNT(*)               AS seen,
       SUM(correct_count > 0) AS ever_correct,
       SUM(answer_count)      AS answers,
       SUM(correct_count)     AS corrects
  FROM user_question_stats
 WHERE user_id = ?1
 GROUP BY chapter_id;
```

## Conventions

**Everything is 1-based.** `question_options.ordinal` is literally the N in the
source JSON's `optN`, so the 1-based `correct_option_index` maps to it as the
identity — no arithmetic, nothing to get backwards. Same for
`attempt_answers.selected_ordinal`, `delivered_position`,
`attempt_questions.position`, `chapters.ordinal`, `subchapters.ordinal`. The
current client converts to 0-based (`correct_option_index - 1` in
`frontend/src/services/localData.ts`), which means every read and write has to
remember which side of the boundary it is on.

**Question identity is content, not position.** `questions.id` is
`'q_' || substr(content_hash, 1, 16)` where

```
content_hash = sha256('necprep-question-v1' RS nec_code RS norm(stem) RS
                      sorted(norm(option))... joined by US)
RS = U+001E, US = U+001F     norm = NFKC, collapse whitespace, trim, lowercase
```

Why this matters is not theoretical. The old scheme is
`{topicId}_{arrayIndex}` — `'book-ch1_238'` means "the 239th element of
ch1.json". While this schema was being written, a de-duplication pass shrank
the bank from 2,801 rows to 2,312, and the positional quarantine list in
`frontend/src/data/quarantine.json` went wrong in both directions at once:
entries now naming healthy questions, and genuinely mis-keyed questions no
longer excluded. Every bookmark and progress record in every user's
`localStorage` has the same defect. `questions.legacy_id` exists only so the
one-time client migration can translate them, and is expected to be dropped
after the cutover.

**Option identity is a slot, not content.** `question_options.id` is
`question_id || '#' || ordinal`, enforced by a `CHECK`. `ordinal` is assigned
once and **never reused**: retiring option 3 and adding a replacement gives the
new one ordinal 5, so a historical answer can never be silently re-pointed at
different text. That is the opposite of `questions` on purpose — there identity
is content, here it is a slot that survives content edits, and between them
nothing a human does to the bank can change the meaning of an answer already
recorded.

**SQLite, written as SQLite.** No native enums (`CHECK` constraints — and
`db:verify` compares each one against the TypeScript union). No `jsonb` (`TEXT`
+ `json_valid()` + json1). No materialised views (precomputed snapshot tables).
Generated columns are used where they earn their place: `users.email_normalized`,
`question_options.text_norm`, `attempts.score_bp`,
`user_question_stats.accuracy_bp`, `study_sessions.duration_s`, and
`attempt_answers.selected_option_id` (VIRTUAL — zero bytes, fully joinable).
Every table is `STRICT`. Timestamps are INTEGER unix seconds; calendar days,
where a day is the unit of meaning, are TEXT `'YYYY-MM-DD'` in the *user's*
timezone — Nepal is UTC+05:45, so a UTC-based streak would break for anyone
studying after 18:15 local.

**Ratios in basis points, not floats.** `score_bp`, `accuracy_bp`, `p_value_bp`
are integers 0–10000. Exact, sortable, indexable, and immune to the
"99.99999%" rendering bug.

## Migrations

- `NNNN_lower_snake.sql`, applied in filename order, no gaps.
  `db/apply.mjs` enforces the naming and the numbering.
- **No `BEGIN`/`COMMIT`/`ROLLBACK`** — `wrangler d1 migrations apply` wraps each
  file itself. `db/apply.mjs` rejects them, so you find out locally.
- **No `PRAGMA`, `ATTACH` or `VACUUM`** — D1 rejects all three. Same check.
- Foreign keys are on by default in D1; `db/apply.mjs` turns them on explicitly
  so a broken reference fails locally too (the `sqlite3` CLI leaves them off).
- SQLite cannot `ALTER TABLE … ADD CONSTRAINT`, so a new constraint means
  create-copy-rename. Write it as a numbered migration, not a hand-edit.

Applied migrations are immutable. Edit one only before it has run anywhere.

## Seeding

```bash
npm run db:seed:local                      # import the bank
node db/seed/import-questions.mjs --dry-run --json   # report without writing
npm run db:reference                       # regenerate 0007 from the frontend files
```

The importer is idempotent (content-hash ids make it an upsert), and it
**re-derives defects from the data** rather than trusting
`quarantine.json`'s positional ids:

| code | meaning |
|---|---|
| `OPTION_DUPLICATE` | two options with identical normalised text |
| `INDEX_RANGE` | `correct_option_index` outside `1..option_count` |
| `KEY_CONFLICT` | `correct_option` text is not any of the options |
| `DUPLICATE_ANSWER_CONFLICT` | two questions share a stem but their keys name different text (cross-row, so it needs the second pass `planCrossRowDefects` makes) |
| `OPTION_COUNT`, `EMPTY_STEM` | structurally unusable |

A defective question is imported with `status = 'flagged'` and a
`question_reports` row carrying the evidence (`source = 'validator'`), so it is
excluded from selection without being deleted — `status` exists exactly so the
raw row survives for whoever has to adjudicate it. `quarantine.json` is still
read, but only to *file a report* where its legacy id resolves to a question
the rules consider healthy: hiding a question that passes every rule, on the
strength of a stale array index, is the bug this schema exists to end.

Measured on the current bank:

```
source rows read              2312
exact duplicates collapsed      22     (identical stem+options within one chapter)
cross-chapter dup groups         2
questions written             2290
  published                   2190
  flagged (withheld)           100
options written               9160
  retired as duplicate text      6
  pinned ('all of the above')  450 across 450 questions, all in slot 4
answer keys written           2289     (the INDEX_RANGE question has no reachable answer)
published without a key          0     ← the importer aborts if this is non-zero
errata reports filed           125

defect codes  {"DUPLICATE_ANSWER_CONFLICT":82,"OPTION_DUPLICATE":5,"KEY_CONFLICT":14,"INDEX_RANGE":1}
quarantine.json cross-check  {"entries":145,"resolved":123,"agreed":100,"stale":23,"unresolvable":22}
```

Read that last line as the argument for content-hash ids: of 145 positional
quarantine entries, 22 no longer resolve to any array slot at all and 23 point
at a question the rules find healthy.

## Operational notes for handler authors

- **Budget: 50 queries per Worker invocation** on the free plan (1,000 paid).
  Batch. `NQ-10b` grades a whole paper in one statement; `NQ-19b` expands a
  ten-rule blueprint in one. Work done inside a trigger belongs to the
  statement that fired it and does **not** count — which is why eleven triggers
  maintain the rollups instead of handler code.
- **D1 is single-threaded per database.** Nothing on a request path may scan a
  large table. That is why leaderboards are snapshots and the progress page is
  a rollup.
- **Fail closed on missing config.** No secret has a default. A missing
  `wrangler secret` must throw at startup.
- **`attempts.id` vs `attempts.public_id`.** URLs carry the ULID; the integer
  is internal, and exists because every `attempt_answers` row references it.
  Resolve `public_id` → `id` once per request, not per answer.
- **Deleting a question that has been answered is refused** by a foreign key.
  Use `status = 'retired'`. Same for options: `retired_at`, never `DELETE`.
- **Partial-index upserts must restate the predicate.** `ON CONFLICT (user_id,
  dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING` — omit the `WHERE` and
  `prepare()` fails at runtime with "ON CONFLICT clause does not match any
  PRIMARY KEY or UNIQUE constraint". This one was found by `db/smoke.mjs`, not
  by review.

## Reconciliation with `worker/src/**` (ACTION REQUIRED)

`worker/src/**` was written concurrently by another author against an *assumed*
schema declared in `src/data/tables.ts` (`SCHEMA_ASSUMPTION_VERSION =
'2026-10-20.1'`). The two do not match, and nothing ships until one of them
moves. The deltas, so the decision is a diff and not an excavation:

| area | `migrations/` (this schema) | `src/data/tables.ts` (assumed) |
|---|---|---|
| **timestamps** | INTEGER unix **seconds** | INTEGER epoch **milliseconds** |
| attempts | one `attempts` table, `mode` column | split `mock_attempts` + `practice_sessions` |
| attempt paper | `attempt_questions` | `mock_attempt_questions` + `practice_session_questions` |
| answers | one `attempt_answers` | `mock_answers` + `practice_answers` |
| answer key | `question_answer_keys.correct_option_id` (own table) | `question_options.is_correct` |
| SRS | `srs_state` | `srs_cards` (+ `revision`) |
| templates | `mock_test_templates` (JSON `blueprint`) | `mock_templates` + `mock_template_blueprint` rows |
| audit | `admin_audit_log` | `audit_log` |
| syllabus | `subjects`, `chapters`, `subchapters` (60 NEC codes) | `chapters` only |
| rollups | `user_question_stats` (+ denormalised `chapter_id`) | `user_question_stats`, `user_chapter_stats`, `user_daily_activity` |
| not in this schema | — | `oauth_accounts`, `oauth_states`, `idempotency_keys`, `rate_limits` |
| not in that schema | `explanations`, `tags`, `question_tags`, `content_versions`, `leaderboard_snapshots`, `leaderboard_entries`, `notifications`, `study_sessions`, `streaks`, `attempt_answers_archive`, `questions_fts` | — |

**The highest-risk mismatch is the timestamp unit**, and that author flagged it
first: seconds here, milliseconds there. `domain/expiry.ts` misbehaves silently
under the wrong one. Seconds is the choice made here and the reason is in
`0001_identity.sql` — millisecond precision buys nothing for session expiry or
`answered_at`, and the one unbounded table is budgeted at 132.4 bytes/row.
`time_ms` is the deliberate exception: per-question latency genuinely needs
milliseconds, and its name says so.

Three items on that author's checklist deserve direct answers:

1. **"`question_options.id` must be opaque."** It is not, and that is
   deliberate — but the objection is correct that a raw `q_abc#3` handed to a
   browser leaks the authored slot. The resolution is at the delivery layer,
   not in the id: `attempt_questions.option_order` is the server-side mapping,
   so deliver an index into it (or an HMAC under `option_seed`) and resolve the
   handle server-side. The full argument, including what permutation does *not*
   buy for the 2,290 already-public questions, is in the second block of
   `0004_assessment.sql`.
2. **"`questions` must not carry `correct_option_index` / `correct_option`."**
   It does not. Those two source fields are kept as
   `question_answer_keys.authored_index` / `authored_text` — in the server-only
   table, where a `SELECT *` on `questions` cannot reach them.
3. **"Keep the index list short; D1 counts index writes."** Agreed and acted
   on: `attempt_answers` has exactly three indexes and each carries the named
   query it serves. 68% of its 132.4 bytes/row is index, and
   `idx_attempt_answers_question_correct` is named in `0004` as the first
   candidate to drop if the ceiling gets close.

## Known gaps

- **Not verified against production D1.** Everything above was verified on
  SQLite 3.54 and Miniflare's local D1; no Cloudflare account was provisioned.
  `STRICT` and FTS5 both work in Miniflare and D1 documents full SQLite SQL
  support, but confirm both on the first real deploy.
- `database_id` in `wrangler.toml` is a placeholder. It fails loudly rather
  than plausibly, which is the point.
- `questions.subchapter_id` is NULL for all 2,290 imported questions. The
  source JSON has no syllabus field, so the importer does not guess;
  classifying them is a contributor workflow, and `NQ-38b` is the queue that
  drives it.
- `questions.p_value_bp`, `tags`/`question_tags`, `explanations` and
  `content_versions` are modelled and indexed but unpopulated — the jobs and
  editor flows that fill them are later phases.
