/**
 * THE SINGLE STATEMENT OF WHAT THIS API ASSUMES ABOUT THE DATABASE.
 *
 * The Drizzle schema and the migrations under `worker/db/` and
 * `worker/migrations/` are owned by another author and were written
 * concurrently with this API, so nothing here imports them. Instead this file
 * declares, in one place, exactly the tables and columns the handlers read and
 * write. The test harness applies `ASSUMED_SCHEMA_DDL` to a local SQLite
 * database, so the suite proves the API against these assumptions and
 * reconciling the two is a diff against this file rather than an archaeology
 * exercise across thirty modules.
 *
 * THE SHIPPED MIGRATIONS HAVE SINCE BEEN READ. The detailed delta - what
 * matched, what has to change, and the table-by-table name map - is at the
 * bottom of this file. The headline: that schema is good, but its timestamps
 * are SECONDS where this API is milliseconds, its `users.email` is NOT NULL so
 * there is nowhere to put an anonymous guest, and four tables this API needs do
 * not exist yet. The DDL below stays as written until that remap is done
 * deliberately, because it is what the passing test suite runs against.
 */

export const T = {
  users: 'users',
  oauthAccounts: 'oauth_accounts',
  oauthStates: 'oauth_states',
  sessions: 'sessions',

  chapters: 'chapters',
  questions: 'questions',
  questionOptions: 'question_options',
  mockTemplates: 'mock_templates',
  mockTemplateBlueprint: 'mock_template_blueprint',

  mockAttempts: 'mock_attempts',
  mockAttemptQuestions: 'mock_attempt_questions',
  mockAnswers: 'mock_answers',

  practiceSessions: 'practice_sessions',
  practiceSessionQuestions: 'practice_session_questions',
  practiceAnswers: 'practice_answers',

  userQuestionStats: 'user_question_stats',
  userChapterStats: 'user_chapter_stats',
  userDailyActivity: 'user_daily_activity',

  bookmarks: 'bookmarks',
  srsCards: 'srs_cards',
  questionReports: 'question_reports',
  auditLog: 'audit_log',

  idempotencyKeys: 'idempotency_keys',
  rateLimits: 'rate_limits',
} as const;

/**
 * Applied verbatim by the test harness against `node:sqlite`.
 *
 * Written as plain SQLite DDL (no Drizzle, no dialect extensions) so it is
 * equally valid as a `wrangler d1 execute --local` input and as a reference for
 * the real migration. Column types follow D1 conventions: timestamps are
 * INTEGER epoch milliseconds, booleans are INTEGER 0/1, ids are TEXT.
 */
export const ASSUMED_SCHEMA_DDL: string[] = [
  // --- Identity -------------------------------------------------------------

  // An anonymous guest is a real row with `is_anonymous = 1` and a NULL email.
  // Upgrading fills in email/password_hash and flips the flag WITHOUT changing
  // `id`, so every attempt, bookmark and SRS card already written survives.
  `CREATE TABLE users (
     id             TEXT PRIMARY KEY,
     email          TEXT,
     email_verified INTEGER NOT NULL DEFAULT 0,
     password_hash  TEXT,
     display_name   TEXT,
     role           TEXT NOT NULL DEFAULT 'user',
     is_anonymous   INTEGER NOT NULL DEFAULT 0,
     created_at     INTEGER NOT NULL,
     updated_at     INTEGER NOT NULL
   )`,
  // Partial unique index: many anonymous users share a NULL email, but a
  // claimed email must be unique. Enforced by the DB, not by a read-then-write.
  `CREATE UNIQUE INDEX ux_users_email ON users (email) WHERE email IS NOT NULL`,

  `CREATE TABLE oauth_accounts (
     id                  TEXT PRIMARY KEY,
     user_id             TEXT NOT NULL REFERENCES users(id),
     provider            TEXT NOT NULL,
     provider_account_id TEXT NOT NULL,
     created_at          INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX ux_oauth_provider_account
     ON oauth_accounts (provider, provider_account_id)`,
  `CREATE INDEX ix_oauth_user ON oauth_accounts (user_id)`,

  // Short-lived CSRF/PKCE parking space for an in-flight OAuth round trip.
  `CREATE TABLE oauth_states (
     state         TEXT PRIMARY KEY,
     code_verifier TEXT NOT NULL,
     redirect_to   TEXT,
     created_at    INTEGER NOT NULL,
     expires_at    INTEGER NOT NULL
   )`,

  // The session cookie carries only `id`. Everything authoritative is here.
  `CREATE TABLE sessions (
     id           TEXT PRIMARY KEY,
     user_id      TEXT NOT NULL REFERENCES users(id),
     created_at   INTEGER NOT NULL,
     expires_at   INTEGER NOT NULL,
     last_seen_at INTEGER NOT NULL,
     user_agent   TEXT,
     ip_hash      TEXT,
     revoked_at   INTEGER
   )`,
  `CREATE INDEX ix_sessions_user ON sessions (user_id)`,

  // --- Content --------------------------------------------------------------

  `CREATE TABLE chapters (
     id             TEXT PRIMARY KEY,
     slug           TEXT NOT NULL UNIQUE,
     name           TEXT NOT NULL,
     short_name     TEXT NOT NULL,
     description    TEXT NOT NULL DEFAULT '',
     icon           TEXT NOT NULL DEFAULT 'book',
     color          TEXT NOT NULL DEFAULT '#6366f1',
     order_index    INTEGER NOT NULL DEFAULT 0,
     question_count INTEGER NOT NULL DEFAULT 0
   )`,

  // NOTE: no answer column here, by design. See `question_options.is_correct`.
  `CREATE TABLE questions (
     id          TEXT PRIMARY KEY,
     chapter_id  TEXT NOT NULL REFERENCES chapters(id),
     stem        TEXT NOT NULL,
     explanation TEXT,
     difficulty  INTEGER,
     status      TEXT NOT NULL DEFAULT 'published',
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL
   )`,
  `CREATE INDEX ix_questions_chapter_status ON questions (chapter_id, status)`,

  // THE ANSWER KEY LIVES HERE AND ONLY HERE.
  //
  // `is_correct` is selected by exactly three queries in this codebase
  // (mock review, practice reveal, and the mock scoring join) and by nothing
  // that runs before an answer is committed. `position` is the authored order
  // and is never sent to a client.
  `CREATE TABLE question_options (
     id          TEXT PRIMARY KEY,
     question_id TEXT NOT NULL REFERENCES questions(id),
     body        TEXT NOT NULL,
     is_correct  INTEGER NOT NULL DEFAULT 0,
     position    INTEGER NOT NULL
   )`,
  `CREATE INDEX ix_options_question ON question_options (question_id)`,

  `CREATE TABLE mock_templates (
     id                   TEXT PRIMARY KEY,
     slug                 TEXT NOT NULL UNIQUE,
     name                 TEXT NOT NULL,
     description          TEXT NOT NULL DEFAULT '',
     duration_minutes     INTEGER NOT NULL,
     questions_per_chapter INTEGER NOT NULL DEFAULT 0,
     total_questions      INTEGER NOT NULL DEFAULT 0,
     is_active            INTEGER NOT NULL DEFAULT 1
   )`,

  // One row per chapter per template. The paper composition is server data;
  // the client never tells the server how many questions to draw.
  `CREATE TABLE mock_template_blueprint (
     id             TEXT PRIMARY KEY,
     template_id    TEXT NOT NULL REFERENCES mock_templates(id),
     chapter_id     TEXT NOT NULL REFERENCES chapters(id),
     question_count INTEGER NOT NULL,
     position       INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX ix_blueprint_template ON mock_template_blueprint (template_id)`,

  // --- Mock attempts --------------------------------------------------------

  // `expires_at` is written once, by the server, at start. Nothing in the API
  // can move it later, which is what makes the clamp in `domain/expiry.ts`
  // meaningful.
  //
  // `synced_answers` holds the last snapshot the server accepted strictly
  // before the deadline; the guard is in the UPDATE statement itself (see
  // `data/mock.ts#syncAnswers`), so a stalled client cannot overwrite it with
  // post-deadline work.
  `CREATE TABLE mock_attempts (
     id               TEXT PRIMARY KEY,
     user_id          TEXT NOT NULL REFERENCES users(id),
     template_id      TEXT NOT NULL REFERENCES mock_templates(id),
     status           TEXT NOT NULL DEFAULT 'in_progress',
     started_at       INTEGER NOT NULL,
     expires_at       INTEGER NOT NULL,
     duration_seconds INTEGER NOT NULL,
     question_count   INTEGER NOT NULL,
     submitted_at     INTEGER,
     scored_at        INTEGER,
     score            INTEGER,
     timing           TEXT,
     synced_answers   TEXT,
     last_sync_at     INTEGER
   )`,
  `CREATE INDEX ix_mock_attempts_user ON mock_attempts (user_id, started_at)`,

  // The paper. `option_order` is a JSON array of question_options.id in the
  // per-attempt permuted order; `option_refs` is a parallel JSON array of
  // opaque per-attempt tokens. The client only ever sees `option_refs`, so a
  // ref cannot be joined against option position in the public chapter JSON,
  // and a ref captured from one attempt is meaningless in another.
  `CREATE TABLE mock_attempt_questions (
     id           TEXT PRIMARY KEY,
     attempt_id   TEXT NOT NULL REFERENCES mock_attempts(id),
     question_id  TEXT NOT NULL REFERENCES questions(id),
     chapter_id   TEXT NOT NULL REFERENCES chapters(id),
     position     INTEGER NOT NULL,
     option_order TEXT NOT NULL,
     option_refs  TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX ux_maq_attempt_question
     ON mock_attempt_questions (attempt_id, question_id)`,

  `CREATE TABLE mock_answers (
     id          TEXT PRIMARY KEY,
     attempt_id  TEXT NOT NULL REFERENCES mock_attempts(id),
     question_id TEXT NOT NULL REFERENCES questions(id),
     option_id   TEXT,
     is_correct  INTEGER NOT NULL DEFAULT 0,
     answered_at INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX ux_mock_answers_attempt_question
     ON mock_answers (attempt_id, question_id)`,

  // --- Practice sessions ----------------------------------------------------

  `CREATE TABLE practice_sessions (
     id             TEXT PRIMARY KEY,
     user_id        TEXT NOT NULL REFERENCES users(id),
     mode           TEXT NOT NULL,
     chapter_ids    TEXT,
     status         TEXT NOT NULL DEFAULT 'in_progress',
     started_at     INTEGER NOT NULL,
     finished_at    INTEGER,
     question_count INTEGER NOT NULL,
     answered_count INTEGER NOT NULL DEFAULT 0,
     correct_count  INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX ix_practice_sessions_user
     ON practice_sessions (user_id, started_at)`,

  `CREATE TABLE practice_session_questions (
     id           TEXT PRIMARY KEY,
     session_id   TEXT NOT NULL REFERENCES practice_sessions(id),
     question_id  TEXT NOT NULL REFERENCES questions(id),
     chapter_id   TEXT NOT NULL REFERENCES chapters(id),
     position     INTEGER NOT NULL,
     option_order TEXT NOT NULL,
     option_refs  TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX ux_psq_session_question
     ON practice_session_questions (session_id, question_id)`,

  // `latency_ms`, `flagged_guess` and `confidence` are learner telemetry, not
  // scoring inputs. They exist so the spaced-repetition grade can be derived
  // server-side the way `frontend/src/services/scheduler.ts` already does it
  // (see `ratingFromOutcome`), instead of the client grading its own cards.
  `CREATE TABLE practice_answers (
     id           TEXT PRIMARY KEY,
     session_id   TEXT NOT NULL REFERENCES practice_sessions(id),
     question_id  TEXT NOT NULL REFERENCES questions(id),
     option_id    TEXT,
     is_correct   INTEGER NOT NULL DEFAULT 0,
     answered_at  INTEGER NOT NULL,
     latency_ms   INTEGER,
     flagged_guess INTEGER NOT NULL DEFAULT 0,
     confidence   INTEGER
   )`,
  `CREATE UNIQUE INDEX ux_practice_answers_session_question
     ON practice_answers (session_id, question_id)`,

  // --- Progress rollups -----------------------------------------------------

  // Rollups rather than an append-only event log. D1 Free allows 100k row
  // writes per day and index writes count, so a per-answer events table would
  // double the cost of every mock. These three are upserted in one batched
  // statement each, so a 100-question submit costs 100 + <=10 + 1 rows.
  `CREATE TABLE user_question_stats (
     user_id         TEXT NOT NULL REFERENCES users(id),
     question_id     TEXT NOT NULL REFERENCES questions(id),
     chapter_id      TEXT NOT NULL REFERENCES chapters(id),
     attempts        INTEGER NOT NULL DEFAULT 0,
     correct         INTEGER NOT NULL DEFAULT 0,
     last_correct    INTEGER NOT NULL DEFAULT 0,
     last_answered_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, question_id)
   )`,

  `CREATE TABLE user_chapter_stats (
     user_id    TEXT NOT NULL REFERENCES users(id),
     chapter_id TEXT NOT NULL REFERENCES chapters(id),
     attempted  INTEGER NOT NULL DEFAULT 0,
     correct    INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, chapter_id)
   )`,

  // `day` is YYYY-MM-DD in the activity timezone. Powers streaks with one row
  // per user per active day.
  `CREATE TABLE user_daily_activity (
     user_id   TEXT NOT NULL REFERENCES users(id),
     day       TEXT NOT NULL,
     answered  INTEGER NOT NULL DEFAULT 0,
     correct   INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, day)
   )`,

  // --- Bookmarks, SRS, errata ----------------------------------------------

  `CREATE TABLE bookmarks (
     user_id     TEXT NOT NULL REFERENCES users(id),
     question_id TEXT NOT NULL REFERENCES questions(id),
     created_at  INTEGER NOT NULL,
     PRIMARY KEY (user_id, question_id)
   )`,

  `CREATE TABLE srs_cards (
     user_id          TEXT NOT NULL REFERENCES users(id),
     question_id      TEXT NOT NULL REFERENCES questions(id),
     chapter_id       TEXT NOT NULL REFERENCES chapters(id),
     due_at           INTEGER NOT NULL,
     interval_days    INTEGER NOT NULL DEFAULT 0,
     ease             REAL NOT NULL DEFAULT 2.5,
     reps             INTEGER NOT NULL DEFAULT 0,
     lapses           INTEGER NOT NULL DEFAULT 0,
     state            TEXT NOT NULL DEFAULT 'new',
     revision         INTEGER NOT NULL DEFAULT 0,
     last_reviewed_at INTEGER,
     PRIMARY KEY (user_id, question_id)
   )`,
  `CREATE INDEX ix_srs_due ON srs_cards (user_id, due_at)`,

  `CREATE TABLE question_reports (
     id              TEXT PRIMARY KEY,
     user_id         TEXT NOT NULL REFERENCES users(id),
     question_id     TEXT NOT NULL REFERENCES questions(id),
     chapter_id      TEXT NOT NULL REFERENCES chapters(id),
     reason          TEXT NOT NULL,
     detail          TEXT,
     status          TEXT NOT NULL DEFAULT 'open',
     created_at      INTEGER NOT NULL,
     resolved_at     INTEGER,
     resolved_by     TEXT,
     resolution_note TEXT
   )`,
  // One open report per user per question: re-reporting is idempotent without
  // needing an idempotency key.
  `CREATE UNIQUE INDEX ux_reports_user_question
     ON question_reports (user_id, question_id)`,
  `CREATE INDEX ix_reports_status ON question_reports (status, created_at)`,

  `CREATE TABLE audit_log (
     id            TEXT PRIMARY KEY,
     actor_user_id TEXT,
     action        TEXT NOT NULL,
     entity_type   TEXT,
     entity_id     TEXT,
     detail        TEXT,
     created_at    INTEGER NOT NULL
   )`,
  `CREATE INDEX ix_audit_created ON audit_log (created_at)`,

  // --- Infrastructure -------------------------------------------------------

  // Keyed by (user_id, key) so one user's key cannot collide with or read
  // another's. `request_hash` catches a client reusing a key for a different
  // body. A NULL `response_json` means the request is still in flight.
  `CREATE TABLE idempotency_keys (
     user_id       TEXT NOT NULL,
     key           TEXT NOT NULL,
     endpoint      TEXT NOT NULL,
     request_hash  TEXT NOT NULL,
     status_code   INTEGER,
     response_json TEXT,
     created_at    INTEGER NOT NULL,
     PRIMARY KEY (user_id, key)
   )`,
  `CREATE INDEX ix_idempotency_created ON idempotency_keys (created_at)`,

  // Fixed-window counters. Best-effort by construction: D1 is eventually
  // consistent across regions, so a determined attacker gets a few extra
  // attempts per region. Adequate for credential stuffing and submit abuse;
  // documented as such in docs/api.md.
  `CREATE TABLE rate_limits (
     bucket       TEXT PRIMARY KEY,
     window_start INTEGER NOT NULL,
     count        INTEGER NOT NULL
   )`,
];

/**
 * RECONCILIATION WITH THE SHIPPED SCHEMA.
 *
 * `worker/migrations/0001..0007_*.sql` and `worker/db/schema.ts` landed while
 * this API was being written. They were READ, not imported. That design is
 * sound and in several places better than what is assumed above - but the
 * NAMES and two of the CONVENTIONS differ, so the adapter layer in
 * `worker/src/data/` has to be remapped onto it. That remapping touches this
 * directory ONLY; nothing above `data/` knows a table name.
 *
 * CONFIRMED CONVERGENCE - the two designs independently reached the same
 * conclusions, which is reassuring:
 *
 *   - `attempt_questions.option_order` is a JSON array of option ids, with the
 *     comment "Ids, never indices". Identical to the assumption above.
 *   - `attempts.option_seed` exists, for a reproducible per-attempt permutation.
 *   - `question_answer_keys` is a SEPARATE table from `question_options`, which
 *     is stronger than the `is_correct` column assumed above: a query cannot
 *     reach the key by accident, it has to join another table.
 *   - `question_options.is_pinned` marks "All of the above" options so the
 *     permuter cannot move them. Same rule as `lib/permute.ts`.
 *   - `users.email_normalized` is a generated lowercase column, matching the
 *     handler-side `normalizeEmail`.
 *   - `questions_fts` (FTS5) exists, so `searchQuestions` can drop its LIKE
 *     scan for a real index.
 *   - `subchapters` and `questions.subchapter_id` exist, so the sub-chapter
 *     blueprint in `frontend/src/data/examBlueprint.ts` is reachable - note 12.
 *   - `attempt_answers.time_ms` and `.revised` exist, which is exactly what
 *     `POST /api/practice/answer` now accepts as `latencyMs` / `flaggedGuess`.
 *
 * MUST FIX BEFORE THIS API RUNS AGAINST THE REAL SCHEMA:
 *
 * 1. TIMESTAMPS ARE SECONDS, NOT MILLISECONDS. The migrations default every
 *    timestamp to `unixepoch()`, which is whole seconds. Everything in this
 *    Worker - `lib/time.ts`, `domain/expiry.ts`, every `EpochMs` on the wire -
 *    is milliseconds. This is THE highest-risk mismatch, because it does not
 *    fail loudly: it makes a 45-minute deadline expire in 45 milliseconds.
 *    Either the migrations move to `unixepoch(\'subsec\') * 1000`, or `data/`
 *    converts at the boundary. Converting in `data/` is the smaller change and
 *    keeps the wire contract in milliseconds, which the client needs for a
 *    smooth countdown.
 *
 * 2. `users.email` IS `NOT NULL`, AND THERE IS NO `is_anonymous`. The
 *    anonymous-guest identity in `handlers/auth.ts` needs a nullable email (or
 *    a reserved synthetic one) plus a flag. The shipped `users.role` is
 *    `student|contributor|admin` where this API expects `user|moderator|admin`,
 *    and `users.status` adds `suspended|deleted`, which `requireUser` should
 *    also check. Without an anonymous identity, `POST /api/auth/anonymous`
 *    cannot work - and with it goes the ability to sit a server-scored mock
 *    without signing up, which is the whole reason guests get a real row.
 *
 * 3. FOUR TABLES THIS API REQUIRES DO NOT EXIST:
 *      - `idempotency_keys` - the entire offline-replay contract rests on it.
 *      - `rate_limits`      - auth and submit limiting rest on it.
 *      - `oauth_accounts`   - Google sign-in cannot link an identity without it.
 *      - `oauth_states`     - the PKCE/CSRF parking space for the callback.
 *    The DDL above is the proposal for all four.
 *
 * 4. `attempts` IS A UNIFIED TABLE (`mode IN (\'practice\',\'mock\',\'srs\',
 *    \'bookmark_review\',\'weak_areas\')`) where `data/mock.ts` and
 *    `data/practice.ts` assume separate `mock_attempts` and
 *    `practice_sessions`. The unified shape is better - `readAttemptHistory`
 *    stops being a UNION ALL. The split in this directory collapses into it.
 *
 * 5. `attempts.id` IS AN INTEGER ROWID with a separate ULID `public_id` that
 *    appears in URLs. This API passes one id end to end. `data/` must resolve
 *    `public_id` to the internal id on the way in, and must never emit the
 *    integer - it is enumerable.
 *
 * 6. `attempt_answers` STORES `selected_ordinal`, not an option id, with a
 *    composite FK to `question_options (question_id, ordinal)`. Scoring here
 *    resolves an opaque ref to an option id; the adapter then has to split the
 *    ordinal back off that id to write the row.
 *
 * 7. `mock_attempts.synced_answers` / `.last_sync_at` HAVE NO EQUIVALENT, and
 *    they are what makes the expiry clamp honest - the last snapshot the server
 *    accepted before the deadline. `attempts` has `deadline_at` and an index on
 *    it, but nowhere to put a pre-deadline answer snapshot. Two columns on
 *    `attempts` is the smallest fix. Without them a late submission can only be
 *    scored as zero or trusted wholesale, and both of those are wrong.
 *
 * 8. OPTION IDS ARE `question_id || \'#\' || ordinal`, SO THEY ARE NOT OPAQUE.
 *    `question_options` carries `CHECK (id = question_id || \'#\' || ordinal)`,
 *    which is a genuinely good integrity constraint - it is what lets
 *    `question_answer_keys` prove with a prefix test that a key cannot point at
 *    another question\'s option. But it means the authored ordinal is readable
 *    straight off the id, and `frontend/public/data/books/*.json` publishes
 *    `correct_option_index` and is in git history forever. So an option id in a
 *    client payload IS the answer key, and a per-viewer permutation is no
 *    defence, because the ordinal travels inside the id rather than as a
 *    position in the array.
 *    This was a live hole in the content-browsing endpoint, and it is fixed:
 *    `lib/permute.ts#browseOptionRef` emits a keyed, non-reversible digest
 *    instead. The attempt endpoints were never affected - they mint CSPRNG refs
 *    per attempt and store the mapping. The CHECK constraint can stay; the rule
 *    is simply that `question_options.id` must never reach a client, and
 *    `__tests__/content-refs.test.ts` holds that line.
 *
 * 9. `sessions.id` IS THE SHA-256 HEX OF THE COOKIE VALUE, not the cookie
 *    itself. That is better than what `data/auth.ts` does today, where the
 *    cookie value IS the stored id - so a database leak currently yields usable
 *    session cookies. Adopt the hashed form. The shipped schema also splits
 *    idle `expires_at` from `absolute_expires_at`, which
 *    `touchSessionStatement` should slide rather than the single TTL above.
 *
 * 10. STREAKS. The shipped schema has `streaks` and `study_sessions` (with a
 *     `user_local_date`); this API assumes `user_daily_activity`.
 *     `domain/streaks.ts` is pure and day-keyed, so it works against either -
 *     only the read in `data/progress.ts` changes. Watch the timezone: streaks
 *     here are bucketed at UTC+05:45, which is the candidate\'s calendar day.
 *
 * 11. NAME MAP for the remap, as read from the migrations:
 *       mock_templates             -> mock_test_templates
 *       mock_attempts              -> attempts (mode=\'mock\')
 *       practice_sessions          -> attempts (mode=\'practice\'|\'srs\'|...)
 *       mock_attempt_questions     -> attempt_questions
 *       practice_session_questions -> attempt_questions
 *       mock_answers               -> attempt_answers
 *       practice_answers           -> attempt_answers
 *       srs_cards                  -> srs_state
 *       audit_log                  -> admin_audit_log
 *       question_options.body      -> question_options.text
 *       question_options.position  -> question_options.ordinal
 *       questions.explanation      -> explanations (separate table)
 *       user_daily_activity        -> streaks + study_sessions
 *     `chapters`, `questions`, `question_options`, `bookmarks`,
 *     `question_reports`, `user_question_stats`, `users` and `sessions` keep
 *     their names but not all of their columns.
 *
 * GAPS AGAINST WHAT THE FRONTEND ALREADY MODELS:
 *
 * 12. THE BLUEPRINT IS SUB-CHAPTER LEVEL.
 *     `frontend/src/data/examBlueprint.ts` publishes a `selectionBlueprint` of
 *     100 questions across 60 official sub-chapters with a documented
 *     largest-remainder weighting rule (sub-chapters 1-4 of a chapter
 *     contribute 2 questions, 5-6 contribute 1). It ships
 *     `strictBlueprint: false` and falls back to chapter-level sampling because
 *     no question in the bank carries a sub-chapter tag yet.
 *     `mock_template_blueprint` above is chapter-level, which matches that
 *     fallback exactly - and the shipped schema HAS `subchapters` plus
 *     `questions.subchapter_id`, so the real blueprint becomes reachable as
 *     soon as tagging coverage is real. `drawChapterPools()` then partitions by
 *     sub-chapter instead of by chapter, and its window function already has
 *     the right shape for it.
 *
 * 13. `srs_state` VERSUS `scheduler.ts`.
 *     `frontend/src/services/scheduler.ts` is an FSRS-flavoured scheduler whose
 *     `Card` carries `stability`, `difficulty` (1-10), `elapsedDays`,
 *     `scheduledDays`, `lapses`, `state`, `due` and `lastReview`, with latency
 *     thresholds and a leech threshold. `domain/srs.ts` here is a deliberately
 *     simpler SM-2 that fits the columns assumed above. Moving `scheduler.ts`
 *     server-side unchanged - the right end state, since a client-scheduled
 *     card can be brought forward at will - needs those columns on `srs_state`.
 *
 * 14. THE OUTBOX SHOULD PROBABLY LIVE IN INDEXEDDB.
 *     `frontend/src/services/responseLog.ts` already maintains an IndexedDB
 *     response log (`necprep-learner`/`responses`) whose `ResponseRecord.rid`
 *     is documented as "globally unique; the merge key across devices" - which
 *     is precisely an idempotency key. The outbox in
 *     `frontend/src/services/api.ts` uses localStorage only because this change
 *     must not edit any other frontend file. Note also that
 *     `ResponseRecord.chosenIndex` is an INDEX into the presented options;
 *     against this API it has to become a ref, or the record cannot be replayed.
 *
 * 15. PRACTICE MODE VOCABULARY DIVERGES FOUR WAYS.
 *     `shared/types.ts`: `chapter|bookmarks|srs|wrong|custom`.
 *     `attempts.mode`: `practice|mock|srs|bookmark_review|weak_areas`.
 *     `responseLog.PRACTICE_MODES`: `topic|quick|custom|mock|review|flashcard`.
 *     `features/quiz/types.ts`: `topic|quick|custom|mock|bookmarks`.
 *     The shipped `attempts.mode` has a CHECK constraint, so it wins by
 *     default; the other three should be mapped onto it before the UI is wired.
 *
 * 16. `lib/permute.ts` DUPLICATES `frontend/src/services/optionOrdering.ts`
 *     (`POSITIONAL_OPTION_RE`, `hashSeed`, `seededRandom`, `fisherYates`).
 *     Same algorithm, now authoritative on the server - and the shipped schema
 *     has `question_options.is_pinned`, which should replace the regex. The
 *     client copy should become presentation-only, or the two will drift and a
 *     stored `option_order` will stop matching what is rendered.
 */
export const SCHEMA_ASSUMPTION_VERSION = '2026-10-20.1';
