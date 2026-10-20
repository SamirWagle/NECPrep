# ADR 0001 — Cloudflare Workers + D1 + Drizzle, not Supabase

- **Status:** Accepted
- **Date:** 2026-10-20
- **Deciders:** NECPrep platform rebuild, phase 0
- **Supersedes:** the Supabase integration removed in the localStorage-only
  rewrite (`frontend/src/services/localData.ts` still opens with the comment
  "replaces all Supabase API calls")
- **Affects:** `worker/**`, and every authorization decision on the platform

## Context

NECPrep is a question bank and mock-exam platform for the Nepal Engineering
Council registration exam. Today it has no backend at all: 2,290 questions ship
as public JSON under `frontend/public/data/books/`, and all progress,
bookmarks and quiz history live in `localStorage`. Phase 0 of the rebuild adds
a real backend.

The requirements that actually constrain the choice:

1. **The answer key must not be reachable by a client.** Today it is a field in
   a public JSON file. Any backend that lets a browser talk to the database
   directly has to keep the key safe with a row- or column-level policy, and
   that policy is one misconfiguration away from publishing the entire exam.
2. **Students are in Nepal.** Round-trip latency from Kathmandu to the nearest
   `us-east` or `ap-south` managed-Postgres region is a real cost on a
   question-by-question interaction loop.
3. **It must be free at the current scale and cheap at 10× it.** This is a
   student project serving exam candidates, not a funded product.
4. **One unbounded table.** `attempt_answers` grows at roughly 500 rows per
   active user per month and nothing else on the platform grows without bound.
   Whatever we pick, we need to know its storage and write ceilings *before*
   building on it.

## Decision

**Cloudflare Workers + D1 (serverless SQLite) + Drizzle ORM.** All
authorization is hand-written in the Worker. No client ever holds a database
credential.

## Alternatives considered

### Supabase (Postgres + PostgREST + RLS + GoTrue auth)

The most capable option on features: real Postgres, managed auth, row-level
security, realtime, storage, generous free tier. Rejected on two grounds.

The first is architectural. Supabase's value proposition is that the browser
talks to PostgREST directly with a JWT, and row-level security policies decide
what it may see. For most applications that is a good trade. For an exam
platform it inverts the thing we most need to be true: the answer key becomes
reachable-by-default and safe only because a policy says so. `SELECT * FROM
questions` from a browser is a supported, documented, one-line operation, and
the only thing standing between it and the answer key is a correctly written
policy on every table, forever, including every table added later. Getting a
policy wrong is a configuration mistake with no compile step, no type error and
no test that fails by default — and the cost of getting it wrong once is the
whole product.

The second is operational. Supabase free-tier projects pause after seven days
of inactivity and the free tier allows two active projects; a paused database
is a dead platform for however long it takes someone to notice. The paid tier
starts at $25/month.

### Neon (or Prisma Postgres) behind Cloudflare Hyperdrive

Attractive because it keeps real Postgres and the Worker runtime. Rejected
because it is two vendors, two bills and two failure domains for a platform
whose entire dataset is 2,290 questions and some per-user counters.

It is worth being precise about what Hyperdrive is, because its placement in
Cloudflare's docs invites the misreading: **Hyperdrive is a connection pooler
and query cache, not a database.** Cloudflare has **no first-party managed
Postgres**. It partners with PlanetScale, and it routes Neon and Prisma
Postgres through Hyperdrive. Choosing "Postgres on Cloudflare" therefore always
means choosing a second provider, with its own region (so requirement 2 is back
in play), its own free-tier rules, and a connection-pool sizing problem that D1
simply does not have.

### Firebase / Firestore

Rejected for the same client-direct-to-database reason as Supabase, with the
security-rules DSL in place of RLS, plus a document model that fits this domain
badly. The hot query is "draw 10 published questions from chapter 2 excluding
the 100 flagged ones", which is a relational filter; the schema is thoroughly
relational (questions → options → answer keys → attempts → answers); and
`leaderboard_snapshots` and `user_question_stats` are aggregates that Firestore
charges per document to compute.

### PlanetScale

Cloudflare's own managed-database partner, and technically strong — but
PlanetScale **removed its free tier** in April 2024. Paid-only from the first
day disqualifies it against requirement 3.

### Keep localStorage

The honest baseline, and it is what ships today. Rejected because every
requirement the rebuild exists to meet — accounts, cross-device progress,
contributor workflows, errata reporting, leaderboards, an answer key that is
not in the git history — needs server state.

## Evidence: D1's actual limits

These are the numbers the schema is designed against. They are stated here so
that a future reader can check whether a decision still holds rather than
re-deriving it.

| | Free | Workers Paid ($5/mo) |
|---|---|---|
| Storage, total | 5 GB | 250 GB |
| Storage, **per database** | **500 MB** | 10 GB |
| Databases | 10 | 50,000 |
| Rows read / day | 5 million | 25 billion / month |
| Rows written / day | **100,000** | 50 million / month |
| **Queries per Worker invocation** | **50** | 1,000 |

Other properties that shaped the schema:

- **Single-threaded per database.** D1 serialises queries against one database
  and sustains roughly 1,000 queries/second at 1 ms each. One slow full-table
  scan blocks every write behind it.
- **Max 100 columns per table**, max 2 MB per row.
- **No `VACUUM`.** Deleting rows frees pages for reuse but never shrinks the
  file, so a retention window bounds the live set rather than the file size.
- **No row-level security.** SQLite has none to expose.

And the one number that is ours, not Cloudflare's — measured, not estimated, by
`npm run db:measure` against the real schema with all three of its indexes and
the rollup triggers live:

```
attempt_answers (table b-tree)         42.7 bytes/row
uq_attempt_answers_attempt_question    33.1
idx_attempt_answers_answered_at        25.7
idx_attempt_answers_question_correct   30.9
                                      ------
TOTAL                                 132.4 bytes/row
```

So a 500 MB free D1 database holds **3.92 million answer rows**; a 10 GB paid
one holds 81 million. The rest of the schema — 2,290 questions, 9,160 options,
the 60 syllabus codes and the FTS5 index — measures 5.1 MB.

## Consequences

### No row-level security. Authorization is code, and that is the point.

This is the decision's sharpest edge and it is deliberate, so it is worth
stating as a positive rather than as a cost.

D1 has no RLS, so the client cannot be allowed to talk to the database at all —
and that removes the client-direct-to-database path *entirely*. There is no
anon key, no JWT the browser presents to the database, no PostgREST endpoint,
no "one policy away from publishing the answer key". The answer key's exposure
surface by default is zero, and increasing it requires someone to write a
handler that names `question_answer_keys` in a `FROM` clause. That is a
grep-able, reviewable, testable event. An RLS policy's absence is not.

The schema then makes the safe path the easy path:

- `questions` has **no** correct-answer column. `question_options` has **no**
  `is_correct` column. The key lives only in `question_answer_keys`, one row
  per question.
- `SELECT * FROM questions JOIN question_options …` — the shape every delivery
  handler actually writes — therefore cannot leak the key, even written
  carelessly, even with a stray `SELECT *`, even from an endpoint added next
  year by someone who has not read this file.
- `v_question_delivery` is the view the delivery path reads. A SQLite view
  grants nothing; its value is that it is the shortest correct thing to write
  and it cannot reference the key table.
- Papers are permuted per attempt (`attempt_questions.option_order`, a JSON
  array of **option ids**, never positions), because the public JSON bank is in
  git history permanently and a fixed option order would let a captured paper
  be graded offline by position.

The cost is real: every authorization predicate must be written in every
handler, every time. The three permitted answer-key queries are written out
verbatim in `worker/migrations/0002_content.sql` and `worker/README.md`
precisely so that "write it yourself" does not mean "invent it yourself".

### No managed auth

No GoTrue, no Firebase Auth. We own password hashing, session cookies, email
verification and password reset. `0001_identity.sql` is written for it:
`sessions.id` is the SHA-256 digest of the cookie value rather than the cookie
itself, so a dump of the table does not let anyone sign in; sessions carry both
an idle clock and an absolute ceiling so a stolen cookie cannot be renewed
forever; and `users` is split from `user_profiles` so the leaderboard joins a
table that physically contains no credential.

### Single writer, and batching is not optional

D1 serialises writes per database, so nothing on a request path may scan a
large table. Two consequences are baked into the schema rather than left to
discipline:

- **Leaderboards are precomputed.** `leaderboard_snapshots` plus
  `leaderboard_entries` are written by a cron Worker. The naive
  `SUM(is_correct) … GROUP BY user_id` over the answer log would scan millions
  of rows per page view, block every write behind it, and stop being correct
  the moment archival ran.
- **Rollups are trigger-maintained.** The 50-queries-per-invocation free-tier
  limit means a handler cannot spend two or three of its budget on
  bookkeeping. Work done inside a trigger is part of the statement that fired
  it and does not count against that budget, so `user_question_stats`,
  `attempts.correct_count`, `tags.question_count` and the FTS5 index are all
  maintained by the eleven triggers in `0003`/`0005`. The progress page is then
  one covering index scan (`NQ-27`), not an aggregate over the answer log — and
  it keeps working after archival deletes that log.

Grading a 100-question mock is one batched statement (`NQ-10b`), not 100
queries, for the same reason.

### Archival is a day-one requirement, not a later optimisation

With a 90-day retention window: 1,000 MAU is 1.5 M live answer rows (189 MB) —
fits free. 10,000 MAU is 15 M rows (1.85 GB) — needs Paid. The binding
constraint on the free plan is not storage but the **100,000 row-writes-per-day
cap**: D1 counts index rows as writes, so one answer is four row writes, and
~1,500 MAU saturates it. The retention job, the exact queries it runs, and the
reason there is deliberately **no** `DELETE` trigger on `attempt_answers` are
documented in `0004_assessment.sql`.

### Cost projection

- **Free to roughly 1,000–1,500 MAU** (bounded by D1's daily write cap, not by
  storage).
- **$5/month beyond that** — the Workers Paid plan, which covers 10,000 MAU at
  90-day answer retention with room to spare, and includes D1, Workers, cron
  triggers and R2 for the archive drain.
- **Beyond ~25,000 MAU**, shard `attempt_answers` across D1 databases by user
  id, or move that one table to Durable Object SQL storage. Both are
  schema-compatible with what is written today, because nothing joins
  `attempt_answers` across users — a constraint worth keeping.

### Drizzle, but the SQL is the source of truth

`worker/migrations/*.sql` is authoritative. `worker/db/schema.ts` is a typed
client, not a DDL generator: Drizzle cannot express `STRICT` tables, triggers,
FTS5 virtual tables, `DESC` index keys, or partial-index predicates in their
exact SQLite form, so `drizzle-kit generate` would silently drop most of what
makes this schema correct. `npm run db:verify` introspects a migrated database
and fails on any drift between the two — 308 columns, 65 indexes, 49 foreign
keys and 35 enums compared, including the TypeScript literal unions against the
SQL `CHECK … IN (…)` lists.

### Vendor lock-in is modest

D1 is SQLite. The migrations are ordinary SQLite DDL and `wrangler d1 export`
produces a plain `.sql` dump. The portable exit is Turso or LiteFS; the costly
one is Postgres, which would mean rewriting the generated columns, the triggers
and the FTS5 index. The Worker-side authorization code, which is the real
investment, ports anywhere.

## Verification

Reproduce every claim above:

```bash
cd worker && npm install
npm run db:check       # apply migrations, import the bank, verify parity, smoke, typecheck
npm run db:measure     # re-measure bytes/row and re-derive the ceiling table
npm run d1:migrate:local   # the same migrations through wrangler's D1 runner
```

Measured on SQLite 3.54 and on Miniflare's local D1: 7 migrations apply clean,
28 tables + 1 view + 1 FTS5 table, 65 indexes, 11 triggers, 59/59 smoke
assertions pass.

## What this ADR does not claim

- It does not claim D1 is a better database than Postgres. It is not.
- It does not claim hand-written authorization is less work than RLS. It is
  more work. It claims the work is more reviewable, and that for a schema whose
  crown jewel is an answer key, a zero-exposure default beats a policy-guarded
  one.
- It has **not** been verified against production D1. Everything here was
  verified locally against SQLite 3.54 and Miniflare's D1 emulation; no
  Cloudflare account was provisioned. `STRICT` tables and FTS5 both work in
  Miniflare, and D1 documents full SQLite SQL support, but the first real
  deploy should confirm both before anyone relies on this paragraph.
