/**
 * THE TABLE NAMES THIS API READS AND WRITES.
 *
 * ===========================================================================
 * THIS FILE USED TO DECLARE AN ASSUMED SCHEMA. IT NO LONGER DOES.
 * ===========================================================================
 *
 * `worker/src/**` and `worker/migrations/**` were written concurrently against
 * different assumptions. This file held `ASSUMED_SCHEMA_DDL` -- a parallel
 * description of the database that the test harness applied, so the suite
 * proved the API against its own assumptions rather than against the schema it
 * would actually run on. That was the right call while the two halves were
 * being built; it is the wrong one now that they have to be one system, because
 * two descriptions of one database is exactly how a 45-minute deadline comes to
 * expire in 45 milliseconds.
 *
 * So the DDL is gone. `src/__tests__/harness.ts` now applies
 * `worker/migrations/*.sql` verbatim, and the only thing left here is the map
 * of names. Anything the API gets wrong about the schema is now a test failure
 * against the real DDL rather than a passing suite against a fiction.
 *
 * The constants below are the CANONICAL names from the migrations. Where the
 * API's earlier shape differed, the migrations won on names and the adapters in
 * this directory changed -- see the reconciliation record at the foot of this
 * file for what moved, what did not, and why.
 */

export const T = {
  // 0001_identity
  users: 'users',
  userProfiles: 'user_profiles',
  sessions: 'sessions',
  oauthAccounts: 'oauth_accounts',
  oauthStates: 'oauth_states',
  adminAuditLog: 'admin_audit_log',

  // 0002_content
  subjects: 'subjects',
  chapters: 'chapters',
  subchapters: 'subchapters',
  questions: 'questions',
  questionOptions: 'question_options',
  /**
   * *** SERVER-ONLY. *** Must not appear in any query whose result can reach a
   * client before that client's attempt is submitted. The three permitted
   * queries are written out in migrations/0002_content.sql (NQ-10, NQ-10b,
   * NQ-10c). In this codebase exactly one function names it:
   * `data/content.ts#loadAnswerKey`.
   */
  questionAnswerKeys: 'question_answer_keys',
  /** The delivery projection. It cannot join the key table, by construction. */
  questionDelivery: 'v_question_delivery',
  explanations: 'explanations',
  questionReports: 'question_reports',

  // 0003_search
  questionsFts: 'questions_fts',

  // 0004_assessment
  mockTestTemplates: 'mock_test_templates',
  /** ONE table for every sitting: mock, practice, SRS, bookmark and weak-area. */
  attempts: 'attempts',
  attemptQuestions: 'attempt_questions',
  attemptAnswers: 'attempt_answers',

  // 0005_learning
  bookmarks: 'bookmarks',
  srsState: 'srs_state',
  studySessions: 'study_sessions',
  streaks: 'streaks',
  userQuestionStats: 'user_question_stats',

  // 0006_engagement. Written only by the scheduled jobs in src/jobs/ and read
  // by the leaderboard and notification endpoints; never computed on a
  // request path.
  leaderboardSnapshots: 'leaderboard_snapshots',
  leaderboardEntries: 'leaderboard_entries',
  notifications: 'notifications',

  // 0008_api_infrastructure
  idempotencyKeys: 'idempotency_keys',
  rateLimits: 'rate_limits',
} as const;

/**
 * RECONCILIATION RECORD -- what changed, and which side moved.
 *
 * Kept because the next reader will find two sets of names in the git history
 * and deserve to know which one won and why, rather than inferring it.
 *
 * TIMESTAMPS: MILLISECONDS, and the SQL moved. The migrations defaulted every
 * timestamp to `unixepoch()` (whole seconds) while this Worker was milliseconds
 * end to end. This was the highest-risk delta precisely because it is silent:
 * a 45-minute deadline stored as seconds and compared against `Date.now()` is
 * 45,000 times too small, so every candidate would be handed an expired paper
 * and nothing would throw. Milliseconds won because every consumer is
 * JavaScript -- `Date.now()`, the `EpochMs` wire type, and the client's own
 * response log, quiz drafts and mock `endsAt` are all already milliseconds --
 * so converting at the boundary would have added a conversion to every read
 * and write for no benefit. The default is now
 * `CAST(unixepoch('subsec') * 1000 AS INTEGER)` and `db/smoke.mjs` asserts
 * that a round-tripped 45-minute deadline is still in the future.
 *
 * ANSWER KEY: `question_answer_keys`, and this API moved. It assumed
 * `question_options.is_correct`. The separate table is stronger and the
 * isolation is the whole point of the backend: `questions` has no answer
 * column and `question_options` has none either, so
 * `SELECT * FROM questions JOIN question_options` CANNOT leak the key -- it
 * takes naming a third table in a FROM clause, which is a greppable,
 * reviewable, testable event. `loadAnswerKey` is the one function that does.
 *
 * OPTION IDS: no longer ordinal-bearing, and the SQL moved. Both authors found
 * the same hole independently: ids were `question_id || '#' || ordinal`, and
 * `frontend/public/data/books/*.json` publishes `correct_option_index` and is
 * in git history forever, so any option id reaching a client recovered the
 * whole key with no database access -- and per-attempt permutation was no
 * defence, because the ordinal travelled inside the id rather than as a
 * position. `opt_key` is now 12 CSPRNG base32 characters. The keyed
 * `browseOptionRef` and the per-attempt refs stay as defence in depth; they
 * were never the problem, they were the patch over it.
 *
 * ATTEMPTS: one table, and this API moved. It had `mock_attempts` +
 * `practice_sessions` with parallel question and answer tables either side.
 * The unified `attempts` with a `mode` column is better and
 * `readAttemptHistory` stops being a UNION ALL. `attempts.id` is an INTEGER
 * rowid and `public_id` is the ULID in URLs; `data/attempts.ts` resolves
 * `public_id` -> `id` once per request and never emits the integer, which is
 * enumerable. The two columns the API needed for a pre-deadline snapshot --
 * `synced_answers`, `last_sync_at` -- were added to `attempts`, with a CHECK
 * that the snapshot cannot be stamped past the deadline.
 *
 * ROLLUPS: the triggers do it, and this API moved. `user_question_stats` and
 * `attempts.answered_count`/`correct_count` are maintained by the triggers in
 * 0005, which run inside the statement that writes the answer and so cost
 * nothing against D1's 50-queries-per-invocation budget. Three hand-written
 * upsert statements went away with them. `user_chapter_stats` is gone: NQ-27
 * groups `user_question_stats` by its denormalised `chapter_id` in one covering
 * index scan. `user_daily_activity` is gone: `streaks` (NQ-32a, idempotent per
 * local day) plus `study_sessions.local_date` do the same job in the user's own
 * timezone, which UTC-keyed day buckets could not.
 *
 * NAMES: `srs_state` not `srs_cards`, `admin_audit_log` not `audit_log`,
 * `mock_test_templates` not `mock_templates`, `question_options.text` not
 * `.body`, `question_options.ordinal` not `.position`. `subjects` and
 * `subchapters` had no equivalent here and are kept.
 *
 * BLUEPRINT: sub-chapter level, and the SQL moved. The API's
 * `mock_template_blueprint` was chapter-level rows; the schema's `blueprint`
 * JSON was chapter-level rules. `frontend/src/data/examBlueprint.ts` is right:
 * the official syllabus is 10 chapters x 6 sub-chapters and the frontend models
 * 60 quotas by largest remainder. The blueprint is now version 2 with 60 rules,
 * `domain/blueprint.ts` allocates them with the same documented fallback, and
 * `generate-reference-sql.mjs` derives 0007 from the same rule so the two
 * cannot drift.
 *
 * SRS: FSRS's vocabulary, and this API moved. `srs_state` already carried
 * `stability`, `difficulty`, `elapsed_days` and `scheduled_days` -- the
 * columns `frontend/src/services/scheduler.ts` wants -- so `domain/srs.ts`
 * speaks them instead of SM-2's `ease` and `interval_days`. `revision` is
 * `reps`, which every applied review increments.
 *
 * SESSIONS: `sessions.id` is the SHA-256 hex of the cookie value, and this API
 * moved. It stored the cookie value itself, so a database dump yielded usable
 * session cookies. The schema also splits idle `expires_at` from
 * `absolute_expires_at`, so a stolen cookie cannot be renewed indefinitely;
 * `touchSessionStatement` slides the former and clamps it to the latter.
 *
 * IDENTITY: `users.email` is nullable with `is_anonymous`, and the SQL moved.
 * `NOT NULL` left nowhere to put an anonymous guest, and guests are not a
 * nice-to-have on this product -- the entire current UX is "type a name and
 * start practising", and a server-scored mock with a server-authored deadline
 * is only possible if the sitting belongs to a real row. `display_name` lives
 * on `user_profiles`, which is the half of a user with no credential in it, so
 * `createUser` writes both rows in one batch.
 *
 * FOUR TABLES ADDED for this API: `oauth_accounts` and `oauth_states` in 0001
 * (they are identity), `idempotency_keys` and `rate_limits` in a new
 * `0008_api_infrastructure.sql` (they are HTTP-layer state). The DDL proposed
 * here was reviewed rather than taken as-is; what changed is in the file.
 *
 * STILL OPEN, and deliberately not papered over:
 *
 *   * `questions.subchapter_id` is now populated for about two thirds of the
 *     bank by the deterministic classifier (migration 0009), which is enough
 *     for every rule of all three shipped templates to be satisfied without
 *     fallback. It stays OPEN because those labels are heuristic, recorded as
 *     `subchapter_source = 'heuristic'`: `strict_subchapter` should not be
 *     turned on against machine labels, and the contributor workflow that
 *     confirms or corrects them (NQ-38b) is still unbuilt.
 *   * The outbox in `frontend/src/services/api.ts` uses localStorage where
 *     `responseLog.ts` already has an IndexedDB store whose `rid` is
 *     documented as a cross-device merge key -- i.e. an idempotency key. That
 *     is a frontend change and is out of this change's scope.
 *   * `ResponseRecord.chosenIndex` in `responseLog.ts` is an INDEX into the
 *     presented options. Against this API it has to become a ref, or a stored
 *     record cannot be replayed.
 *   * Practice-mode vocabulary still differs between `shared/types.ts`
 *     (`chapter|bookmarks|srs|wrong|custom`), `attempts.mode`
 *     (`practice|mock|srs|bookmark_review|weak_areas`) and the client's
 *     `responseLog.PRACTICE_MODES`. `attempts.mode` has the CHECK, so it wins;
 *     `data/attempts.ts#modeForPractice` is the one place that maps.
 *   * `lib/permute.ts` still duplicates
 *     `frontend/src/services/optionOrdering.ts`. The server copy is now
 *     authoritative and uses `question_options.is_pinned` rather than the
 *     regex; the client copy should become presentation-only.
 */
export const SCHEMA_RECONCILED_VERSION = '2026-10-20.2';
