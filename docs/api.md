# NECPrep API

The Cloudflare Worker that owns the question bank, scoring, and progress.

Base URL comes from `VITE_API_BASE_URL`. With it unset the frontend never calls
this API at all and falls back to `frontend/src/services/localData.ts`; see
[Running with no backend](#running-with-no-backend).

**Stack:** Cloudflare Workers + D1 (serverless SQLite) + Drizzle + Hono.
**Auth:** self-hosted cookie sessions (D1 has no managed auth).
**Client:** `frontend/src/services/api.ts`, typed from `worker/src/shared/types.ts`.

---

## Contents

- [Why this API exists](#why-this-api-exists)
- [Platform limits this design is shaped by](#platform-limits-this-design-is-shaped-by)
- [Conventions](#conventions)
- [Endpoint reference](#endpoint-reference)
- [The offline outbox contract](#the-offline-outbox-contract)
- [Idempotency](#idempotency)
- [Rate limits](#rate-limits)
- [Errors](#errors)
- [Running with no backend](#running-with-no-backend)
- [Configuration](#configuration)

---

## Why this API exists

`frontend/src/pages/app/MockTestQuiz.tsx` currently fetches the chapter JSON
**including `correct_option_index`**, scores in the browser against
`q.correctIndex`, and runs the exam clock as a client `setInterval`. Two
consequences:

1. Open devtools and you have the entire answer key.
2. Stop the interval, or edit the localStorage draft's `endsAt`, and you have
   unlimited time.

Worse, `frontend/public/data/books/*.json` ships the answer key and will remain
in this repository's git history forever. So it is not enough to stop sending
the key — any endpoint that returns options **in the authored order** lets an
attacker recover the key by joining position to position, without ever touching
the database.

This API makes both attacks structurally impossible:

| Defence | Mechanism |
| --- | --- |
| The key never reaches a pre-answer payload | `is_correct` is selected by exactly one function, `loadAnswerKey` in `worker/src/data/content.ts`. The function that builds option lists, `loadOptionsForQuestions`, does not have that column in its SELECT list. There is no field to forget to delete. |
| Option position cannot be joined to the public JSON | Every option list that leaves the Worker is permuted. Mock and practice papers get a CSPRNG permutation stored per attempt; content browsing gets one seeded from a server-only secret plus the viewer's user id. |
| A ref from one attempt is useless in another | The client names an option by an opaque **ref**: 60 bits of CSPRNG minted per `(attempt, option)` at start and stored on the attempt row. Raw `question_options.id` values never leave the server. |
| The deadline cannot be moved | `mock_attempts.expires_at` is written once by the server at start. No request body anywhere in this API has a field for a time, a duration, or a deadline. |
| Stalling past the deadline gains nothing | Scoring uses the server clock and falls back to the last snapshot the **server itself accepted** before the deadline. See [the expiry clamp](#the-expiry-clamp). |
| A submission cannot assert a score | `MockSubmitRequest` is `{ attemptId, idempotencyKey, answers }` and the validator is **strict** — an extra `score` or `isCorrect` field is a 400, not an ignored field. |

The key is disclosed in exactly two places, both of them after the answer is on
the record:

- `POST /api/mock/submit` and `GET /api/mock/attempts/:id/review` — the whole
  paper, after the attempt is `submitted`.
- `POST /api/practice/answer` — **one** question, after that answer is written.

### The expiry clamp

The only claim a server can verify about timing is *what it received, and when
it received it*. So:

1. While an attempt is live the client pushes its answer map to
   `POST /api/mock/sync` every 10–15 seconds. The `UPDATE` carries
   `AND ?now <= expires_at`, so the stored snapshot is **by construction** a
   pre-deadline state. The guard is in the SQL, not in a preceding read, so
   there is no race to win.
2. A submission inside the grace window (`expires_at + 10s`) is scored from its
   payload. Ten seconds covers network latency and clock skew; it is not enough
   to be useful as working time.
3. A submission after that window has its **payload discarded**. The last
   pre-deadline snapshot is scored instead, `timing` comes back as `expired`,
   and `droppedLateAnswers` says how many answers the clamp refused.

`scoredAt` is always `min(submittedAt, expiresAt)` — the instant the paper was
frozen.

There is deliberately **no `answeredAt` field** on the wire. A client-asserted
answer time is exactly what a cheater would forge, and accepting one would
reintroduce the hole through a different door.

---

## Platform limits this design is shaped by

These are not tunable, and every one of them is visible in the shape of the API.

| Limit | Free plan | Consequence here |
| --- | --- | --- |
| D1 queries per Worker invocation | **50** (1,000 on paid) | `worker/src/data/d1.ts` counts every statement and throws `QueryBudgetExceeded` past a configured budget (default 45). Every response carries `X-D1-Queries`. An accidental N+1 fails the request and the test suite instead of working on a 12-question paper and breaking on a 100-question one. |
| D1 bound parameters per statement | **100** | A 102-question submission is 4 columns × 102 rows = 408 parameters. So multi-row writes pass the payload as **one** JSON parameter and expand it with `json_each()`. `Db` throws `TooManyBoundParams` before the statement is even prepared. |
| D1 rows written per day | **100,000** (index writes count) | Progress is kept as three upserted **rollups**, not an append-only event log. A 102-question submission writes ~102 + ≤10 + 1 rows. An events table would roughly double that and cap the platform at about 80 full mocks a day across all users. |
| D1 transactions | **none** (no interactive transactions, single-threaded per DB) | `db.batch()` is the only atomic write primitive. Concurrency safety comes from guard predicates inside statements plus statement ordering, never from a lock. See [Concurrency](#concurrency-without-transactions). |
| Workers requests per day | **100,000** | Endpoints are coarse. `GET /api/bootstrap` returns session + chapters + templates + content version in one call. `GET /api/progress/overview` returns stats + streaks + recent attempts in one call. The client does not chat. |
| Workers CPU per invocation | ~10 ms | PBKDF2 defaults to 100,000 iterations rather than the OWASP-recommended 600,000. Documented under [Configuration](#configuration); raise it on the paid plan. |

### Concurrency without transactions

Two concurrent mock submissions with **different** idempotency keys cannot both
score, and the mechanism needs no lock:

- Each of the five write statements in the submission batch carries
  `WHERE EXISTS (SELECT 1 FROM mock_attempts WHERE id = ? AND user_id = ? AND status = 'in_progress')`.
- The statement that flips the attempt to `submitted` runs **last**, and its
  `changes` count is the decision.
- A duplicate arriving after the first batch committed finds the guard false,
  writes nothing at all, reports zero changes, and gets
  `409 ATTEMPT_NOT_IN_PROGRESS`.

`POST /api/practice/answer` uses the same device with a
`NOT EXISTS (an answer for this session+question)` guard, which is what makes it
idempotent with no key.

---

## Conventions

- **Transport:** JSON over HTTPS. `Content-Type: application/json` is required
  on any request with a body; anything else is a 400.
- **Auth:** an `HttpOnly; SameSite=Lax; Secure` cookie named `necprep_session`,
  carrying an opaque session id and **nothing else** — no user id, no role, no
  signed claims. Every authenticated request costs one indexed `sessions` join.
  Send `credentials: 'include'`.
- **Timestamps:** integer **epoch milliseconds**, always from the server clock.
  Fields named `serverNow` are provided so the client can render a countdown
  without trusting the device clock.
- **Ownership:** D1 has no row-level security. Every data-access function takes
  `userId` and puts it in the `WHERE` clause; another user's resource reads as
  `404 NOT_FOUND`, never `403`, so ids are not enumerable.
- **Option refs:** opaque strings. Never an index, never a position. The client
  submits a ref and nothing else.
- **Request bodies are strict.** An unknown field is a `400 BAD_REQUEST` with
  `error.fields`, not a silently-stripped or silently-kept value. Bodies over
  128 KB are refused before being read.
- **Query cost** below is measured, not estimated — the numbers come from
  `worker/src/__tests__/query-cost.test.ts` and an instrumented run of every
  handler. `(batch)` marks statements that share one round trip.

---

## Endpoint reference

### Auth

| Method | Path | Auth | D1 cost |
| --- | --- | --- | --- |
| `GET` | `/api/auth/session` | optional | **1** (0 with no cookie) |
| `POST` | `/api/auth/anonymous` | optional | **3** |
| `POST` | `/api/auth/signup` | none | **3** |
| `POST` | `/api/auth/login` | none | **4** |
| `POST` | `/api/auth/logout` | optional | **1** |
| `POST` | `/api/auth/upgrade` | required (anonymous) | **6** |
| `GET` | `/api/auth/google/start` | optional | **1** |
| `GET` | `/api/auth/google/callback` | optional | **4–7** |

#### `GET /api/auth/session`
→ `SessionResponse` · `{ user: SessionUser | null, sessionExpiresAt, serverNow }`

#### `POST /api/auth/anonymous`
No body. → `SessionResponse` with `user.isAnonymous === true`.

Creates a **real `users` row** for a guest. That is the point: a guest's first
mock attempt is written server-side with a server-side deadline from the first
question. The alternative — a client-side guest identity — is the hole this API
exists to close.

**Idempotency:** if the request already carries a live session the existing one
is returned untouched and no new session is minted. Safe to call on every cold
start, which is how the client uses it.

#### `POST /api/auth/signup`
`{ email, password, displayName? }` → `201 SessionResponse`

`password` is 8–200 characters. The ceiling exists because the password is fed
to PBKDF2 and an unbounded input is a cheap CPU-exhaustion vector.

Uniqueness is enforced by a **partial unique index** on `users.email`, not by a
preceding `SELECT`, so two simultaneous signups for one address cannot both win.
Duplicate → `409 EMAIL_IN_USE`.

> The upsert's conflict target must restate the index predicate
> (`ON CONFLICT (email) WHERE email IS NOT NULL`). A bare `ON CONFLICT (email)`
> raises *"does not match any PRIMARY KEY or UNIQUE constraint"* at runtime, on
> every signup. The test suite caught this.

#### `POST /api/auth/login`
`{ email, password }` → `SessionResponse` · wrong credentials →
`401 INVALID_CREDENTIALS`

An unknown address runs a dummy PBKDF2 derivation before answering. Without it
"no such user" returns in a fraction of the time a real verification takes and
response latency becomes a user-enumeration oracle — a vague error message does
not help. A guest row (no password) is treated identically to a nonexistent one.

Rate-limited per IP **and** per email, so one attacker cannot lock every user
out from a single address and one account cannot be hammered from a thousand.

A hash stored with fewer iterations than the current setting verifies and is
transparently rehashed, so the cost can be raised without locking anyone out.

#### `POST /api/auth/upgrade`
`{ email, password, displayName? }` → `SessionResponse`

Turns the **current anonymous session's user** into a real account **in place**.
The user id does not change, so every attempt, bookmark, streak and SRS card the
guest accumulated stays attached. The alternative — create a new user and
migrate — is a multi-table copy with no transaction to protect it, on a database
that has none.

**Idempotency:** the `UPDATE` carries `AND is_anonymous = 1`. A replay matches
zero rows and returns `409 NOT_ANONYMOUS` rather than resetting the password of
an account that has since been claimed. Taken address → `409 EMAIL_IN_USE`.

Other sessions for that user are revoked; the current one survives.

#### `GET /api/auth/google/start`
`?redirect_to=/app/...` (optional) → `302` to Google.

PKCE is used even though this is a confidential client: the verifier is stored
server-side against a single-use `state`, so an intercepted redirect still
cannot be redeemed. Only a path on our own origin is accepted as `redirect_to`,
so `state` cannot bounce a signed-in user to an attacker's site.

#### `GET /api/auth/google/callback`
`?code&state` → `302` to `APP_ORIGIN + redirectTo`

`state` is consumed with `DELETE ... RETURNING`, which is atomic — a replayed
callback finds nothing and gets `400 OAUTH_STATE_INVALID`. An **unverified**
Google email is refused (`OAUTH_EXCHANGE_FAILED`); accepting one would be an
account-takeover path for any address a user has not verified.

Resolution order: existing `oauth_accounts` link → existing user with that
verified email (link added) → the current anonymous guest, claimed in place →
new user.

---

### Content

| Method | Path | Auth | D1 cost |
| --- | --- | --- | --- |
| `GET` | `/api/bootstrap` | optional | **4** |
| `GET` | `/api/content/chapters` | optional | **1** |
| `GET` | `/api/content/mock-templates` | optional | **1** |
| `GET` | `/api/content/chapters/:chapterId/questions` | optional | **3** |
| `GET` | `/api/content/search` | optional | **2** |

#### `GET /api/bootstrap`
→ `BootstrapResponse` · `{ session, chapters, mockTemplates, contentVersion }`

One call for the whole app shell. Four separate calls on every cold start would
burn the 100k requests/day budget four times faster for no benefit.
`contentVersion` is derived from `MAX(questions.updated_at)` and the published
count, so publishing or retiring a question changes it and the client knows to
refetch.

#### `GET /api/content/chapters/:chapterId/questions`
`?offset=0&limit=50` (limit ≤ 100) → `ChapterQuestionsResponse`

Questions **without keys**, for browsing and study. Paged because a chapter holds
up to 746 questions and sending all of them would be a multi-megabyte payload on
a mobile connection.

Options are permuted with a **stable per-viewer** permutation: seeded from
`CONTENT_PERMUTATION_SECRET` + user id + question id, so it cannot be reproduced
by anyone without the secret, but does not reshuffle between reloads (selections
are stored by ref, and a reshuffle would re-point them).

`ref` here is a **keyed, non-reversible digest**, not the `question_options.id`.
That distinction is load-bearing, and the first version of this endpoint got it
wrong: the schema mints option ids as `question_id || '#' || ordinal`
(`worker/migrations/0002_content.sql`), so returning an id hands over the
authored ordinal — and the public chapter JSON publishes
`correct_option_index`, which makes that ordinal the answer. Permuting the array
is no defence when the ordinal travels *inside* the id. It needs no
reversibility because browsing is read-only: a browse ref is never submitted
back, and answering goes through a practice session, which mints its own
per-attempt refs. `worker/src/__tests__/content-refs.test.ts` holds that line.

Options whose meaning depends on being last ("All of the above") are pinned,
matching `frontend/src/services/optionOrdering.ts`.

#### `GET /api/content/search`
`?q=&chapterId=&limit=` (`q` is 2–120 chars) → `SearchResponse`

Stems only — returning options would be a bulk-enumeration path, and the UI only
needs a link. `%` and `_` in the query are escaped, so searching `100%` is a
literal search and not a match-everything wildcard. Rate-limited.

A LIKE scan over ~2,800 published rows. The upgrade path when the bank grows is
FTS5 plus triggers; it is deliberately not here yet, because a stale FTS index
returns silently wrong results, which is worse than a scan.

---

### Mock tests

| Method | Path | Auth | D1 cost (102-question paper) |
| --- | --- | --- | --- |
| `POST` | `/api/mock/start` | required | **10** |
| `GET` | `/api/mock/attempts/:attemptId` | required | **3** |
| `POST` | `/api/mock/sync` | required | **3** |
| `POST` | `/api/mock/submit` | required | **13** |
| `GET` | `/api/mock/attempts/:attemptId/review` | required | **5** |

**All five are constant in the size of the paper.** `start` and `submit` cost
the same 10 and 13 queries at 12 questions and at 102 — asserted in
`worker/src/__tests__/query-cost.test.ts`.

#### `POST /api/mock/start`
`{ templateId, idempotencyKey }` → `MockAttemptPaper`

The server picks the paper from `mock_template_blueprint`. The request names a
template and nothing else: it cannot ask for a shorter paper, an easier chapter,
or a specific question.

Cost breakdown: rate limit 1 · idempotency reserve 1 · template 1 · blueprint 1 ·
pool draw 1 · option bodies 1 · attempt + paper insert 2 *(batch)* ·
paper read-back 1 · idempotency finalise 1.

The random selection happens **in SQLite** with
`ROW_NUMBER() OVER (PARTITION BY chapter_id ORDER BY RANDOM())`, so the Worker
never materialises all 2,800 questions to pick 100. The paper insert is **one
statement** for any number of rows, via `json_each`.

Response carries `startedAt`, `expiresAt`, `serverNow`, `durationSeconds`, and
`questions[]` of `{ questionId, chapterId, position, stem, options: [{ ref, body }] }`.

There is no `correctRef`, no `isCorrect`, and no raw option id anywhere in it —
asserted by scanning the serialised payload for every seeded option id in
`worker/src/__tests__/mock-anticheat.test.ts`.

A chapter that cannot fill its blueprint quota contributes what it has; the
attempt records the **actual** question count. A completely empty paper is
`409 INSUFFICIENT_CONTENT`. (Chapters 5, 6, 7 and 9 hold only 64–71 questions
each, so a hard failure would take every mock offline for one thin chapter.)

**Idempotency:** required key. A replay returns the identical paper **with the
identical refs** — anything else would have the client submitting refs the
server never minted.

#### `GET /api/mock/attempts/:attemptId`
→ `MockAttemptPaper`, with `savedAnswers` from the last accepted sync.

The resume path. A reload does not depend on localStorage surviving, and cannot
be influenced by editing it.

#### `POST /api/mock/sync`
`{ attemptId, answers }` → `MockSyncResponse`
`{ accepted, serverNow, expiresAt, remainingMs, reason? }`

The coarse autosave, and the mechanism that gives the expiry clamp something
true to score. Call it every 10–15 seconds and on page change — **not** on every
keystroke.

`answers` is `questionId → optionRef` and **replaces** the stored snapshot
wholesale. Past the deadline it is refused with `accepted: false` and
`reason: "past_deadline"`, and the stored snapshot does not move.

**Idempotency:** inherent, no key. A replacement is convergent, so the outbox
replays it without a key at all.

#### `POST /api/mock/submit`
`{ attemptId, idempotencyKey, answers }` → `MockSubmitResponse`

Server-side scoring, and the only moment the mock key is disclosed.

Cost breakdown: rate limit 1 · idempotency reserve 1 · attempt 1 · paper 1 ·
answer key 1 · option bodies 1 · commit 6 *(batch)* · idempotency finalise 1.

The commit batch is six statements in **one round trip**: answers, per-question
stats, per-chapter stats, daily activity, SRS cards, then the status flip. Each
of the first five writes the whole paper with a single `INSERT ... SELECT FROM
json_each(?)`, so 102 answers are one statement, not 102 inserts.

Rejections:

| Condition | Response |
| --- | --- |
| Attempt not owned by the caller | `404 NOT_FOUND` |
| Attempt not `in_progress` | `409 ATTEMPT_NOT_IN_PROGRESS` |
| An answer for a question not on this paper | `422 QUESTION_NOT_ON_PAPER` |
| A ref that does not belong to that question on this attempt | `422 UNKNOWN_OPTION_REF` |
| Lost a race with a concurrent submission | `409 ATTEMPT_NOT_IN_PROGRESS`, nothing written |

Strictness is conditional, and the distinction is deliberate: a **live** payload
is strict, because an off-paper id or an unresolvable ref is a client bug or a
probe. The **stored snapshot** on the expired path is lenient, because it was
already accepted once and refusing to score a paper over one stale entry would
penalise a candidate who merely ran out of time.

Response includes `score`, `total`, `correct`, `incorrect`, `skipped`,
`accuracyPct`, `timing` (`on_time` | `expired`), `scoredAt`,
`droppedLateAnswers`, and `review[]` — the per-question payload carrying
`correctRef`, `selectedRef`, `isCorrect` and the explanation.

A question whose stored key points at no option on the paper is **excluded from
`total`**, not marked wrong. The authored bank genuinely contains these — see
`frontend/src/data/quarantine.json` — and marking them wrong would punish the
candidate for a content bug.

**Idempotency:** required key. Replay returns the byte-identical response
without re-scoring or re-counting stats, and costs fewer queries than the
original. Same key with a **different** body → `409 IDEMPOTENCY_KEY_REUSED`;
guessing would be worse than refusing.

#### `GET /api/mock/attempts/:attemptId/review`
→ `MockSubmitResponse`

Re-reads a submitted attempt from what was recorded, so a lost response or a
cleared browser does not lose the paper. A read, so it cannot change a stored
score, and it refuses an attempt that is still `in_progress` — which is what
stops it being a mid-exam key oracle.

---

### Practice (untimed)

| Method | Path | Auth | D1 cost |
| --- | --- | --- | --- |
| `POST` | `/api/practice/start` | required | **7** (50 questions) |
| `GET` | `/api/practice/sessions/:sessionId` | required | **4–5** |
| `POST` | `/api/practice/answer` | required | **9** |
| `POST` | `/api/practice/finish` | required | **4** |

#### `POST /api/practice/start`
`{ mode, chapterIds?, questionCount, idempotencyKey }` → `PracticeSessionPaper`

`mode` is `chapter` | `bookmarks` | `srs` | `wrong` | `custom`. The **source** of
the questions is server-decided: `wrong` means the questions the server's own
stats say the caller got wrong, `srs` means the cards the server says are due.
A client cannot hand over a list of question ids, which would be a way to farm
the per-question reveal for a chosen set.

#### `POST /api/practice/answer`
`{ sessionId, questionId, optionRef, idempotencyKey?, latencyMs?, flaggedGuess?, confidence? }`
→ `PracticeAnswerResponse`

**Practice reveals the key one question at a time, AFTER the answer is
committed.** The ordering is what makes it safe:

1. resolve the submitted ref against the paper stored for this session
2. join the key, compute correctness
3. **write** the answer and the stats (guarded, so a replay cannot re-write)
4. only then put `correctRef` and the explanation in the response

So the key for question 7 becomes visible only once question 7 is answered on
the record. Nothing reveals question 8. Seeing all 50 keys means truthfully
recording 50 answers, which is what practice is for.

`optionRef: null` records a deliberate skip, which still reveals the key but
does not count as an attempt toward accuracy or the revision schedule.

`latencyMs`, `flaggedGuess` and `confidence` are **learner telemetry, and
untrusted**. They are inputs to the spaced-repetition grade only — compare
`ratingFromOutcome` in `frontend/src/services/scheduler.ts` — never to the
score. They are safe to accept from a client precisely because the only thing
they can influence is how soon that learner sees the question again: lying makes
your own revision schedule worse. Correctness is still computed server-side from
the key. A mock answer accepts none of this.

**Idempotency:** inherent on `(sessionId, questionId)`, **no key needed**. The
commit batch guards every increment with `NOT EXISTS (an answer for this pair)`
and the answer `INSERT` runs last, so replaying a queued offline answer
converges instead of inflating the user's stats. A key is accepted for
uniformity.

Another user's session id → `422 QUESTION_NOT_ON_PAPER`. The error does not
confirm the session exists and does not leak any part of the key — asserted for
every question on a victim's paper in `worker/src/__tests__/ownership.test.ts`.

#### `GET /api/practice/sessions/:sessionId`
→ `PracticeSessionPaper`

Resume. `answered` replays `correctRef` for the questions **already answered**
and for no others, so reloading restores exactly the knowledge the user had
earned — it is not a way to read the whole paper's key by starting a session and
reloading. The key query runs only over the answered ids (hence 4 queries when
none are answered, 5 once some are).

#### `POST /api/practice/finish`
`{ sessionId, idempotencyKey }` → `PracticeFinishResponse`

Idempotent twice over: the key, and `AND status = 'in_progress'` on the UPDATE.
A replay returns the same totals rather than a 409.

---

### Progress

| Method | Path | Auth | D1 cost |
| --- | --- | --- | --- |
| `GET` | `/api/progress/overview` | required | **3** |
| `GET` | `/api/progress/history` | required | **1** |

#### `GET /api/progress/overview`
→ `ProgressOverview` · `{ stats, streak, recent }`

One call for the whole dashboard: per-chapter stats, streaks and the ten most
recent attempts. The current client computes all of this by reading every
chapter's JSON and walking localStorage.

Streaks are bucketed by **calendar day in UTC+05:45** (Nepal), not UTC — a 9pm
study session in Kathmandu would otherwise land on the next UTC day and break
the streak. A streak survives "nothing done yet today" and breaks only once a
full day is skipped.

#### `GET /api/progress/history`
`?limit=20&cursor=` → `AttemptHistoryResponse`

Mock and practice attempts in one `UNION ALL`, newest first. `cursor` is the
`started_at` of the last row seen; a malformed cursor is a 400, not a `NaN` that
silently pages from the beginning.

---

### Bookmarks

| Method | Path | Auth | D1 cost |
| --- | --- | --- | --- |
| `GET` | `/api/bookmarks` | required | **1** |
| `PUT` | `/api/bookmarks` | required | **3** |

#### `PUT /api/bookmarks`
`{ questionId, desired, idempotencyKey? }` → `BookmarkSetResponse`

Expressed as a **desired end state**, not as add/remove verbs. That is what
makes it replay-safe: `INSERT ... ON CONFLICT DO NOTHING` and a `DELETE` of a
missing row both converge, so the outbox can replay the same entry any number of
times. A toggle would flip.

The response is read back from the database rather than echoed from the request:
bookmarking an unpublished question is a silent no-op in the SQL, and the client
must be told the truth about the resulting state.

---

### Spaced repetition

| Method | Path | Auth | D1 cost |
| --- | --- | --- | --- |
| `GET` | `/api/srs/due` | required | **1** (nothing due) / **3** |
| `POST` | `/api/srs/review` | required | **3** |

#### `POST /api/srs/review`
`{ questionId, grade, revision, idempotencyKey? }` → `SrsReviewResponse`

`grade` is `again` | `hard` | `good` | `easy`.

**Idempotent through `revision`, not through a key.** The write carries
`AND revision = ?expected`, so a replayed outbox entry whose revision the server
has already moved past changes nothing and comes back as `applied: false` with
the current card. This is strictly better than a key here, because it also makes
a stale review from a second device a no-op instead of a conflict.

The schedule is server state, so a client cannot bring a card forward to farm an
easy session, and it survives a cleared browser.

---

### Errata reports

| Method | Path | Auth | D1 cost |
| --- | --- | --- | --- |
| `POST` | `/api/reports` | required | **2** |
| `GET` | `/api/reports` | required | **1** |

#### `POST /api/reports`
`{ questionId, reason, detail?, idempotencyKey? }` → `{ reportId, created }`

`reason` is `wrong_answer` | `ambiguous` | `typo` | `duplicate` |
`out_of_syllabus` | `other`.

**Idempotent with no key**, through a unique index on `(user_id, question_id)`:
re-reporting updates the existing report instead of filling the triage queue
with duplicates. `created` tells the caller which happened.

The `INSERT` selects from `questions`, so an unknown question id writes nothing
and returns `404` rather than creating an orphan report.

---

### Admin

Behind a role check on `users.role`, read from the database through the session —
never from the cookie, never from a request field, so there is nothing a client
can edit to escalate. An unrecognised role reads as the least privileged.

| Method | Path | Role | D1 cost |
| --- | --- | --- | --- |
| `GET` | `/api/admin/reports` | moderator+ | **1** |
| `POST` | `/api/admin/reports/triage` | moderator+ | **4** (any batch size) |
| `POST` | `/api/admin/questions/publish` | **admin only** | **4** (any batch size) |
| `GET` | `/api/admin/audit` | moderator+ | **1** |

Publishing is admin-only, not moderator, because it changes what candidates sit.

#### `POST /api/admin/reports/triage`
`{ reportIds, status, resolutionNote?, idempotencyKey }` → `{ updated, status }`

Up to 100 ids travel as one JSON parameter, so bulk triage does not scale with
the number of rows.

#### `POST /api/admin/questions/publish`
`{ questionIds, state, idempotencyKey }` → `{ updated, state }`

`state` is `draft` | `published` | `retired`. **Retiring** is the lever that
takes a known-bad question out of every future paper without deleting the
attempts recorded against it — which is what `frontend/src/data/quarantine.ts`
is doing by hand today with a hardcoded id list.

Both mutations write an `audit_log` row **in the same batch** as the mutation, so
there is no path that changes published content without leaving a trace.

---

## The offline outbox contract

The app is a PWA (`vite-plugin-pwa`) used on patchy mobile connections. The
client in `frontend/src/services/api.ts` implements this contract.

### The rule

> **An outbox entry carries an idempotency key minted ONCE at enqueue time, and
> never regenerated on retry.**

A retry with a fresh key is a *second mutation* as far as the server is
concerned: for a mock submission that means `409 ATTEMPT_NOT_IN_PROGRESS`, and
for anything that increments it would mean double-counted progress.

### Replayable mutations

`OutboxEntry` in `worker/src/shared/types.ts` is the closed, discriminated set:

| Kind | Endpoint | Idempotency mechanism |
| --- | --- | --- |
| `mock.sync` | `POST /api/mock/sync` | Snapshot replacement — **no key** |
| `mock.submit` | `POST /api/mock/submit` | **Key required** |
| `practice.answer` | `POST /api/practice/answer` | Unique `(session, question)` |
| `practice.finish` | `POST /api/practice/finish` | **Key required** + status guard |
| `bookmark.set` | `PUT /api/bookmarks` | Desired end state |
| `srs.review` | `POST /api/srs/review` | `revision` guard |
| `report.submit` | `POST /api/reports` | Unique `(user, question)` |

### Draining

`drainOutbox()` replays **oldest first and stops on the first retryable
failure**. Order is load-bearing: a `mock.submit` queued behind a `mock.sync`
must not overtake it, because the sync is what the expiry clamp scores if the
submission turns out to be late. Skipping past a stalled entry would silently
change what gets scored.

| Outcome | Action |
| --- | --- |
| `ok` | Remove, continue |
| `NETWORK_UNAVAILABLE`, `RATE_LIMITED`, `REQUEST_IN_FLIGHT`, 5xx | Increment `attempts`, **stop**, preserve order |
| `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `ATTEMPT_NOT_IN_PROGRESS`, `QUESTION_NOT_ON_PAPER`, `UNKNOWN_OPTION_REF`, `UNAUTHENTICATED`, … | **Drop** and report via `onDropped` |
| 8 attempts reached | Drop |

A permanently-failing entry is dropped rather than kept, because the drain is
ordered: keeping it would block every later mutation forever.

`sendOrQueue(entry)` is the function most call sites want — it tries now and
falls back to the queue, using the **same key** for both, so the eventual replay
cannot duplicate a mutation that actually did land.

Call `drainOutbox()` on `online`, on app focus, and after any successful request.

### What the outbox must not be used for

Auth. A queued `login` or `upgrade` replayed hours later against a changed
server state is confusing at best; both are interactive and must fail loudly.

---

## Idempotency

Send the key in the request **body** as `idempotencyKey`. Keys are 8–80
characters from `[A-Za-z0-9_.:-]` (a `randomUUID()` qualifies) and are scoped to
`(user_id, key)` — one user's key can neither collide with nor read another's.

| Situation | Response |
| --- | --- |
| First use | The work is done; the response is stored |
| Same key, same body, finished | The stored response, replayed verbatim, with `Idempotent-Replay: true` |
| Same key, same body, still in flight | `409 REQUEST_IN_FLIGHT` with `retryAfterMs` |
| Same key, **different** body | `409 IDEMPOTENCY_KEY_REUSED` |

The reservation is a real row with a `NULL response_json`, so two concurrent
copies of the same request cannot both proceed — the second gets `in_flight`
rather than both scoring the same attempt. The body fingerprint is
`SHA-256(endpoint + canonical JSON)`, with object keys sorted and
`idempotencyKey` itself excluded, so a queue rehydrated from storage with a
different key order still fingerprints identically.

If a handler throws, the reservation is released so an immediate retry is not
stuck behind a key that will never be finalised. Records are retained for 7 days.

---

## Rate limits

Fixed-window counters in D1, one query per check, keyed by user id or by hashed
IP (the table stores a hash, never a raw address).

| Bucket | Limit | Window |
| --- | --- | --- |
| `auth:login` (per IP **and** per email) | 10 | 10 min |
| `auth:signup` | 5 | 1 h |
| `auth:anonymous` | 10 | 1 h |
| `auth:upgrade` | 5 | 1 h |
| `mock:start` | 20 | 1 h |
| `mock:submit` | 40 | 1 h |
| `mock:sync` | 240 | 1 h |
| `practice:answer` | 600 | 1 h |
| `report:submit` | 30 | 1 h |
| `content:search` | 120 | 1 h |

Exceeding one gives `429 RATE_LIMITED` with `error.retryAfterMs` and a
`Retry-After` header.

**These are best-effort by construction, and the honest reason is worth writing
down:** D1 replicates asynchronously, so two requests served from different
Cloudflare locations can both read a stale counter and both be allowed. The
effective limit is roughly *limit per window per region*. That is adequate
against credential stuffing, submit hammering and search abuse. It is not a
substitute for a Durable Object or Cloudflare's WAF rate limiting, neither of
which is on the free plan.

---

## Errors

Every failure is `{ "error": { "code", "message", "fields?", "retryAfterMs?" } }`.
Unexpected throws become a bare `500 INTERNAL` with a fixed message — a D1 error
string can contain SQL, column names, and sometimes row values.

| Code | Status | Meaning |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | Validation failed; see `fields` |
| `UNAUTHENTICATED` | 401 | No live session |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `NOT_FOUND` | 404 | Missing, **or owned by someone else** |
| `CONFLICT` | 409 | Generic state conflict |
| `EMAIL_IN_USE` | 409 | Address already claimed |
| `NOT_ANONYMOUS` | 409 | Account already registered |
| `ATTEMPT_NOT_IN_PROGRESS` | 409 | Already submitted, or finished |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key, different body |
| `REQUEST_IN_FLIGHT` | 409 | Duplicate still processing; retry |
| `INSUFFICIENT_CONTENT` | 409 | Not enough published questions |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 128 KB |
| `QUESTION_NOT_ON_PAPER` | 422 | Answer for a question not on this attempt |
| `UNKNOWN_OPTION_REF` | 422 | Ref does not belong to that question here |
| `RATE_LIMITED` | 429 | See `retryAfterMs` |
| `OAUTH_STATE_INVALID` | 400 | Expired or replayed OAuth callback |
| `OAUTH_EXCHANGE_FAILED` | 502 | Google rejected the exchange |
| `INTERNAL` | 500 | Unexpected |
| `BACKEND_NOT_CONFIGURED` | 501 | **Client-synthesised**; no `VITE_API_BASE_URL` |
| `NETWORK_UNAVAILABLE` | 503 | **Client-synthesised**; server unreachable |

The last two are never sent by the Worker. They live in the same union so a
caller can switch over one exhaustive set of codes instead of handling transport
failures through a separate channel.

---

## Running with no backend

The app must keep working with no backend configured — that is the deployment
that is live today. `frontend/src/services/api.ts` **adds to**
`frontend/src/services/localData.ts`; it does not replace it.

With `VITE_API_BASE_URL` unset, `isBackendConfigured()` returns `false` and
nothing in the module issues a request: every function short-circuits to an
`ApiResult` with code `BACKEND_NOT_CONFIGURED`. A call site that forgets to
branch degrades to "no data" rather than to a stack of failed fetches.

```ts
import { isBackendConfigured, api } from '../services/api';
import * as local from '../services/localData';

const chapters = isBackendConfigured()
  ? (await api.getChapters()).data?.chapters ?? []
  : local.bookChapters;
```

**Note the asymmetry, because it is the whole point:** the localStorage path
cannot enforce the anti-cheat guarantees. It has the key in the browser by
construction. Mock tests are only tamper-resistant with a backend configured.

---

## Configuration

Worker bindings. Configuration **fails closed**: a missing secret throws at
request time naming the variable, rather than falling back to a development
default that would ship a predictable permutation secret or an open CORS policy.

| Variable | Required | Notes |
| --- | --- | --- |
| `DB` | yes | D1 binding |
| `APP_ORIGIN` | yes | Drives CORS and OAuth redirects. No wildcard: credentials are cookies, so `Access-Control-Allow-Origin` cannot be `*`, and an unrecognised origin gets no CORS headers at all |
| `CONTENT_PERMUTATION_SECRET` | yes | ≥ 32 chars. Seeds the stable browse permutation. With it, the permutation for a given `(user, question)` can be reproduced offline and joined against the public chapter JSON in git history |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | all or none | A half-configured OAuth app fails with `redirect_uri_mismatch` at Google, which is a confusing place to debug it. Omit all three and the Google routes 404 |
| `PASSWORD_HASH_ITERATIONS` | no | Default `100000`. **Raise to `600000` on the paid plan.** OWASP asks for 600k for PBKDF2-SHA256, but Workers Free allows ~10 ms CPU per invocation and 600k will not fit. The stored hash format is self-describing, so raising this verifies old hashes and transparently rehashes them on next login |
| `D1_QUERY_BUDGET` | no | Default `45`, under the free cap of 50. Raise to ~900 on the paid plan |
| `ENVIRONMENT` | no | `development` disables the `Secure` cookie flag |

`frontend`: `VITE_API_BASE_URL`. Unset means local-only mode.

---

## Schema reconciliation

This API was written alongside the Drizzle schema in `worker/db/` and
`worker/migrations/`, and does not import it. Everything it assumes about the
database is declared in one place — `ASSUMED_SCHEMA_DDL` in
`worker/src/data/tables.ts` — which is also the DDL the test suite runs against,
so the suite is simultaneously a test of this API and an executable statement of
its requirements.

The shipped migrations have since been read. The full delta, with a
table-by-table name map, is in the reconciliation block at the bottom of
`worker/src/data/tables.ts`. **Four items block this API from running against
them as written:**

1. **Timestamps are seconds, not milliseconds.** The migrations default to
   `unixepoch()`. This API is milliseconds throughout. It does not fail loudly —
   it makes a 45-minute deadline expire in 45 milliseconds. Highest-risk item on
   the list.
2. **`users.email` is `NOT NULL` and there is no `is_anonymous`,** so there is
   nowhere to put an anonymous guest — and with the guest goes the ability to
   sit a server-scored mock without signing up.
3. **`idempotency_keys`, `rate_limits`, `oauth_accounts` and `oauth_states` do
   not exist.** The offline replay contract, the rate limits and Google sign-in
   all need them.
4. **`attempts` has nowhere to store a pre-deadline answer snapshot.** Without
   two columns for it, a late submission can only be scored as zero or trusted
   wholesale, and both are wrong.

Everything else is a rename handled inside `worker/src/data/`. Nothing above
that directory knows a table name.

---

## Testing

```bash
node --test "worker/src/__tests__/*.test.ts"
```

88 tests, no dependencies and no network: Node 22's `node:sqlite` provides a
local SQLite database and `node:test` the runner.

The suite drives the **real handlers** — ownership checks, the expiry clamp,
scoring, idempotency, the actual SQL — because everything in `worker/src/handlers/`
is a plain `(ctx, input) => { status, body }` function and the Hono layer in
`worker/src/index.ts` only parses, validates, calls one of them, and serialises.
Nothing is re-implemented for the tests.

The schema under test is `ASSUMED_SCHEMA_DDL` in `worker/src/data/tables.ts`, so
the suite is simultaneously a test of this API and an executable statement of
what it expects from the database.
