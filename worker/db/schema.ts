/**
 * schema.ts -- Drizzle definitions for the NECPrep D1 database.
 *
 * ===========================================================================
 * THE SQL IS THE SOURCE OF TRUTH. THIS FILE IS THE TYPED CLIENT.
 * ===========================================================================
 *
 * `worker/migrations/*.sql` is authoritative. This file exists so handlers get
 * compile-time column names and inferred row types, not so a tool can generate
 * DDL from it.
 *
 * DO NOT RUN `drizzle-kit generate` AGAINST THIS FILE. Drizzle cannot express
 * several things the schema depends on, and a generated migration would
 * silently drop them:
 *
 *   * STRICT tables
 *   * triggers (eleven of them, and they maintain every rollup on the platform)
 *   * FTS5 virtual tables
 *   * `DESC` in index key columns
 *   * partial-index predicates in their exact SQLite form
 *
 * Instead, `npm run db:verify` introspects a migrated database and compares it
 * to this file -- table by table, column by column, index by index, CHECK by
 * CHECK -- and fails if they have drifted. That makes the duplication safe:
 * the two artefacts cannot disagree without CI saying so.
 *
 * The `{ enum: [...] }` option on a text column is TYPES ONLY in Drizzle for
 * SQLite; the runtime constraint is the CHECK in the migration. `db:verify`
 * parses those CHECKs and asserts the two lists are identical, so the union
 * here is not a second, drifting copy of the enum.
 *
 * Timestamps are INTEGER epoch MILLISECONDS, exposed as `number`, deliberately
 * not `{ mode: 'timestamp' }`: a Worker has no local timezone and every date
 * decision on this platform (streaks, leaderboard periods) is made against the
 * user's stored timezone, so an automatic Date conversion would hide the one
 * thing the caller must think about. Milliseconds because every consumer is
 * JavaScript and `Date.now()` is milliseconds; the wire contract in
 * `worker/src/shared/types.ts` calls the unit `EpochMs` and means it. Calendar
 * days are TEXT 'YYYY-MM-DD'.
 *
 * ---------------------------------------------------------------------------
 * ANSWER-KEY RULE, RESTATED HERE BECAUSE THIS IS THE FILE HANDLERS IMPORT
 * ---------------------------------------------------------------------------
 * `questionAnswerKeys` is SERVER-ONLY. It must not appear in any query whose
 * result can reach a client before that client's attempt is submitted. Use
 * `vQuestionDelivery` to deliver questions -- it physically cannot join the key
 * table. The three permitted key queries are written out in
 * migrations/0002_content.sql and in worker/README.md.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  sqliteView,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * INTEGER epoch MILLISECONDS, server-assigned.
 *
 * `unixepoch('subsec')` is REAL seconds at millisecond resolution; the CAST is
 * explicit so a STRICT INTEGER column is never handed a REAL whose conversion
 * could be lossy. Milliseconds and not seconds because every consumer is
 * JavaScript -- see the convention block at the top of
 * migrations/0001_identity.sql for the full argument.
 */
const nowMs = sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`;

// ===========================================================================
// 0001_identity.sql
// ===========================================================================

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** NULL for an anonymous guest. See the note above `users` in 0001. */
    email: text('email'),
    /** Generated + uniquely indexed: case variants of one address cannot both register. */
    emailNormalized: text('email_normalized').generatedAlwaysAs(sql`(lower(trim(email)))`, {
      mode: 'stored',
    }),
    emailVerifiedAt: integer('email_verified_at'),
    /** NULL for OAuth-only accounts and for guests. MUST fail closed in the password path. */
    passwordHash: text('password_hash'),
    passwordAlgo: text('password_algo', { enum: ['pbkdf2-sha256', 'scrypt', 'argon2id'] }),
    /**
     * Four roles, not three. `moderator` works the errata triage queue;
     * `admin` additionally publishes and retires questions, which changes what
     * candidates sit. Folding them together would hand every volunteer who
     * triages a typo report the ability to pull a question from every paper.
     */
    role: text('role', { enum: ['student', 'contributor', 'moderator', 'admin'] })
      .notNull()
      .default('student'),
    /** 1 = anonymous guest, upgradable in place without changing `id`. */
    isAnonymous: integer('is_anonymous').notNull().default(0),
    status: text('status', { enum: ['active', 'suspended', 'deleted'] })
      .notNull()
      .default('active'),
    deletedAt: integer('deleted_at'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
    lastSeenAt: integer('last_seen_at'),
  },
  (t) => [
    /** PARTIAL: guests all carry a NULL email. The upsert must restate this predicate. */
    uniqueIndex('uq_users_email_normalized')
      .on(t.emailNormalized)
      .where(sql`email_normalized IS NOT NULL`),
    index('idx_users_role_created')
      .on(t.role, sql`created_at DESC`)
      .where(sql`status = 'active'`),
    check('users_email_length', sql`email IS NULL OR length(email) BETWEEN 3 AND 254`),
    check('users_anonymous_has_no_email', sql`is_anonymous = 0 OR email IS NULL`),
    check('users_anonymous_has_no_password', sql`is_anonymous = 0 OR password_hash IS NULL`),
    check('users_is_anonymous', sql`is_anonymous IN (0, 1)`),
    check('users_deleted_at', sql`(status = 'deleted') = (deleted_at IS NOT NULL)`),
    check('users_password_algo', sql`password_hash IS NULL OR password_algo IS NOT NULL`),
  ]
);

export const userProfiles = sqliteTable(
  'user_profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    handle: text('handle'),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    institution: text('institution'),
    targetSitting: text('target_sitting'),
    /** TEXT 'YYYY-MM-DD'. */
    targetDate: text('target_date'),
    /** Drives streak day boundaries. Nepal is UTC+05:45; UTC midnight is nobody's day boundary. */
    timezone: text('timezone').notNull().default('Asia/Kathmandu'),
    locale: text('locale').notNull().default('en'),
    /** Default 0: nobody is put on a public ranking without asking. */
    leaderboardOptIn: integer('leaderboard_opt_in').notNull().default(0),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('uq_user_profiles_handle').on(t.handle).where(sql`handle IS NOT NULL`),
    check(
      'user_profiles_target_date',
      sql`target_date IS NULL OR target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
    ),
    check('user_profiles_opt_in', sql`leaderboard_opt_in IN (0, 1)`),
    check('user_profiles_display_name', sql`length(display_name) BETWEEN 1 AND 60`),
    check(
      'user_profiles_handle_shape',
      sql`handle IS NULL OR (length(handle) BETWEEN 3 AND 24 AND handle GLOB '[a-z0-9_]*')`
    ),
  ]
);

export const sessions = sqliteTable(
  'sessions',
  {
    /** sha256 hex of the cookie value. NEVER the cookie value itself. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(nowMs),
    lastUsedAt: integer('last_used_at').notNull().default(nowMs),
    /** Idle expiry, slid forward on use. */
    expiresAt: integer('expires_at').notNull(),
    /** Hard ceiling. Sliding can never pass this, so a stolen cookie cannot be renewed forever. */
    absoluteExpiresAt: integer('absolute_expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    revokedReason: text('revoked_reason', {
      enum: ['logout', 'logout_all', 'password_change', 'admin', 'rotated', 'suspicious'],
    }),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('idx_sessions_user_active')
      .on(t.userId, sql`last_used_at DESC`)
      .where(sql`revoked_at IS NULL`),
    index('idx_sessions_absolute_expires_at').on(t.absoluteExpiresAt),
    check('sessions_id_is_hash', sql`length(id) = 64 AND id GLOB '[0-9a-f]*'`),
    check('sessions_expiry_order', sql`expires_at <= absolute_expires_at`),
    check('sessions_revoked_reason', sql`revoked_at IS NULL OR revoked_reason IS NOT NULL`),
  ]
);

/**
 * The link between a `users` row and a provider identity.
 *
 * `(provider, providerAccountId)` is the only stable identifier a provider
 * gives us, and it is UNIQUE here. Resolving a sign-in by email alone would be
 * an account-takeover path, because a provider can reassign an address.
 */
export const oauthAccounts = sqliteTable(
  'oauth_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['google'] }).notNull(),
    /** The provider's immutable subject id ('sub' for Google). NOT the email. */
    providerAccountId: text('provider_account_id').notNull(),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('uq_oauth_accounts_provider_account').on(t.provider, t.providerAccountId),
    index('idx_oauth_accounts_user').on(t.userId, t.provider),
    check(
      'oauth_accounts_account_id_nonblank',
      sql`length(trim(provider_account_id)) > 0`
    ),
  ]
);

/**
 * The CSRF/PKCE parking space for one in-flight OAuth round trip.
 *
 * SINGLE USE: the callback consumes the row with `DELETE ... RETURNING`, so a
 * replayed `?code=` finds nothing. `codeVerifier` never reaches the browser,
 * which is what makes PKCE worth doing even for a confidential client.
 */
export const oauthStates = sqliteTable(
  'oauth_states',
  {
    state: text('state').primaryKey(),
    codeVerifier: text('code_verifier').notNull(),
    /** A PATH on our own origin, or NULL. Never an absolute URL. */
    redirectTo: text('redirect_to'),
    createdAt: integer('created_at').notNull().default(nowMs),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [
    index('idx_oauth_states_expires_at').on(t.expiresAt),
    check('oauth_states_redirect_is_path', sql`redirect_to IS NULL OR redirect_to GLOB '/*'`),
    check('oauth_states_expiry_order', sql`expires_at > created_at`),
    check('oauth_states_verifier_length', sql`length(code_verifier) BETWEEN 43 AND 128`),
  ]
);

export const adminAuditLog = sqliteTable(
  'admin_audit_log',
  {
    id: integer('id').primaryKey(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role', {
      enum: ['student', 'contributor', 'moderator', 'admin', 'system'],
    }).notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    /** Redacted JSON. Never a password hash, never a session id. */
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    reason: text('reason'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (t) => [
    index('idx_admin_audit_log_actor').on(t.actorUserId, sql`id DESC`),
    index('idx_admin_audit_log_entity').on(t.entityType, t.entityId, sql`id DESC`),
    index('idx_admin_audit_log_created_at').on(sql`created_at DESC`),
    check('admin_audit_log_before_json', sql`before_json IS NULL OR json_valid(before_json)`),
    check('admin_audit_log_after_json', sql`after_json IS NULL OR json_valid(after_json)`),
  ]
);

// ===========================================================================
// 0002_content.sql
// ===========================================================================

export const subjects = sqliteTable(
  'subjects',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    examBoard: text('exam_board').notNull().default('Nepal Engineering Council'),
    ordinal: integer('ordinal').notNull().default(1),
    status: text('status', { enum: ['draft', 'published', 'retired'] })
      .notNull()
      .default('published'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => [uniqueIndex('uq_subjects_code').on(t.code)]
);

export const chapters = sqliteTable(
  'chapters',
  {
    /** 'book-ch1'..'book-ch10' -- the existing frontend ids, kept for a frictionless cutover. */
    id: text('id').primaryKey(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    /** Official NEC paper code: 'AExE01'..'AALL10'. Goes into the question content hash. */
    necCode: text('nec_code').notNull(),
    ordinal: integer('ordinal').notNull(),
    slug: text('slug').notNull(),
    /** Official NEC syllabus title. */
    title: text('title').notNull(),
    /** The shorter string the practice cards show. */
    displayName: text('display_name').notNull(),
    shortName: text('short_name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#6366f1'),
    icon: text('icon').notNull().default('book'),
    legacyDataFile: text('legacy_data_file'),
    status: text('status', { enum: ['draft', 'published', 'retired'] })
      .notNull()
      .default('published'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => [
    index('idx_chapters_subject_ordinal').on(t.subjectId, t.ordinal),
    uniqueIndex('uq_chapters_nec_code').on(t.necCode),
    uniqueIndex('uq_chapters_slug').on(t.subjectId, t.slug),
    check(
      'chapters_color',
      sql`color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'`
    ),
    check('chapters_ordinal', sql`ordinal > 0`),
  ]
);

/** The 60 official NEC syllabus codes, '1.1'..'10.6'. Six per chapter. */
export const subchapters = sqliteTable(
  'subchapters',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    ordinal: integer('ordinal').notNull(),
    title: text('title').notNull(),
    /** The NEC syllabus paragraph verbatim. It is the authoritative scope statement. */
    description: text('description'),
    status: text('status', { enum: ['draft', 'published', 'retired'] })
      .notNull()
      .default('published'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => [
    index('idx_subchapters_chapter_ordinal').on(t.chapterId, t.ordinal),
    uniqueIndex('uq_subchapters_code').on(t.code),
    check('subchapters_ordinal', sql`ordinal > 0`),
    check('subchapters_code', sql`code GLOB '[0-9]*.[0-9]*'`),
  ]
);

/**
 * questions -- NO ANSWER COLUMN, by design. See migrations/0002_content.sql.
 * `id` is `'q_' || substr(content_hash, 1, 16)`: identity is content, never
 * array position.
 */
export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    /** Full sha256 hex, 64 chars, UNIQUE. A 16-hex prefix collision fails the PK insert. */
    contentHash: text('content_hash').notNull(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'restrict' }),
    /** NULL until a contributor classifies it. The importer never guesses. */
    subchapterId: text('subchapter_id').references(() => subchapters.id, { onDelete: 'set null' }),
    stem: text('stem').notNull(),
    stemFormat: text('stem_format', { enum: ['plain', 'markdown', 'latex'] })
      .notNull()
      .default('plain'),
    /** 'published' is the ONLY status the delivery path may select. */
    status: text('status', { enum: ['draft', 'published', 'flagged', 'retired'] })
      .notNull()
      .default('draft'),
    statusReason: text('status_reason', {
      enum: [
        'KEY_CONFLICT',
        'INDEX_RANGE',
        'OPTION_DUPLICATE',
        'OPTION_MULTIPLE_TRUE',
        'OPTION_COUNT',
        'EMPTY_STEM',
        'DUPLICATE_ANSWER_CONFLICT',
        'USER_REPORT',
        'DUPLICATE',
        'OUT_OF_SYLLABUS',
        'EDITORIAL',
      ],
    }),
    statusChangedAt: integer('status_changed_at').notNull().default(nowMs),
    /** Editorial judgement. `pValueBp` is the observed reality. */
    difficulty: text('difficulty', { enum: ['easy', 'medium', 'hard'] }),
    pValueBp: integer('p_value_bp'),
    pValueN: integer('p_value_n').notNull().default(0),
    /** 1 if any option must stay last ('All of the above'). The permuter must honour it. */
    hasPinnedOptions: integer('has_pinned_options').notNull().default(0),
    source: text('source', { enum: ['book-import', 'contributor', 'past-paper', 'generated'] })
      .notNull()
      .default('book-import'),
    sourceRef: text('source_ref'),
    /** Old `{topicId}_{arrayIndex}` id. Import + one-time client migration ONLY. */
    legacyId: text('legacy_id'),
    /** Lineage when an edit replaces this question. Self-referential. */
    supersededBy: text('superseded_by').references((): AnySQLiteColumn => questions.id, {
      onDelete: 'set null',
    }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('uq_questions_content_hash').on(t.contentHash),
    uniqueIndex('uq_questions_legacy_id').on(t.legacyId).where(sql`legacy_id IS NOT NULL`),
    index('idx_questions_published_chapter')
      .on(t.chapterId, t.id)
      .where(sql`status = 'published'`),
    index('idx_questions_published_subchapter')
      .on(t.subchapterId, t.id)
      .where(sql`status = 'published' AND subchapter_id IS NOT NULL`),
    index('idx_questions_moderation')
      .on(t.status, t.statusChangedAt)
      .where(sql`status IN ('draft', 'flagged')`),
    index('idx_questions_unclassified').on(t.chapterId, t.id).where(sql`subchapter_id IS NULL`),
    check('questions_content_hash', sql`length(content_hash) = 64 AND content_hash GLOB '[0-9a-f]*'`),
    check('questions_id_from_hash', sql`id = 'q_' || substr(content_hash, 1, 16)`),
    check('questions_stem_nonblank', sql`length(trim(stem)) > 0`),
    check('questions_p_value_bp', sql`p_value_bp IS NULL OR p_value_bp BETWEEN 0 AND 10000`),
    check('questions_has_pinned_options', sql`has_pinned_options IN (0, 1)`),
    check('questions_flagged_needs_reason', sql`status <> 'flagged' OR status_reason IS NOT NULL`),
    check('questions_superseded_by', sql`superseded_by IS NULL OR superseded_by <> id`),
  ]
);

/**
 * question_options -- its own table, never a JSON array.
 *
 * `id` is `question_id || '#' || opt_key`, enforced by a CHECK, where `opt_key`
 * is 12 CSPRNG base32 characters. It USED to be `|| ordinal`, and that was a
 * real leak: the bank ships as public JSON carrying `correct_option_index` and
 * is in git history forever, so an ordinal-bearing option id reaching a client
 * recovered the whole answer key with no database access. Read the block above
 * `question_options` in migrations/0002_content.sql before changing this.
 *
 * `ordinal` survives as the authored slot (1-based, the N in optN) and is NEVER
 * REUSED, so an option edit can never re-point a historical answer -- but it is
 * SERVER-ONLY: no view, no delivery query, no response body. Display order is
 * not here either; see `attemptQuestions.optionOrder`.
 */
export const questionOptions = sqliteTable(
  'question_options',
  {
    id: text('id').primaryKey(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    /** Authored slot. SERVER-ONLY -- never delivered, never in a view. */
    ordinal: integer('ordinal').notNull(),
    /** The id discriminator: 12 CSPRNG base32 chars, carrying no information. */
    optKey: text('opt_key').notNull(),
    text: text('text').notNull(),
    textFormat: text('text_format', { enum: ['plain', 'markdown', 'latex'] })
      .notNull()
      .default('plain'),
    textNorm: text('text_norm').generatedAlwaysAs(sql`(lower(trim(text)))`, { mode: 'stored' }),
    /** 'All of the above' and friends. The permuter pins these last. */
    isPinned: integer('is_pinned').notNull().default(0),
    /** Set instead of deleting, so no ordinal is ever freed for reuse. */
    retiredAt: integer('retired_at'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('uq_question_options_question_ordinal').on(t.questionId, t.ordinal),
    /** Parent side of attemptAnswers' composite foreign key. */
    uniqueIndex('uq_question_options_question_opt_key').on(t.questionId, t.optKey),
    uniqueIndex('uq_question_options_question_text')
      .on(t.questionId, t.textNorm)
      .where(sql`retired_at IS NULL`),
    check('question_options_ordinal', sql`ordinal BETWEEN 1 AND 26`),
    check('question_options_is_pinned', sql`is_pinned IN (0, 1)`),
    check(
      'question_options_opt_key_shape',
      sql`length(opt_key) = 12 AND opt_key GLOB '[0-9A-Z]*'`
    ),
    check('question_options_id_shape', sql`id = question_id || '#' || opt_key`),
    check('question_options_text_nonblank', sql`length(trim(text)) > 0`),
  ]
);

/**
 * *** SERVER-ONLY. DO NOT NAME THIS TABLE IN A HANDLER THAT RESPONDS BEFORE
 * *** AN ATTEMPT IS SUBMITTED. ***
 *
 * The only place the answer key exists. The three permitted queries are
 * written out in migrations/0002_content.sql (NQ-10, NQ-10b, NQ-10c) and
 * repeated in worker/README.md.
 */
export const questionAnswerKeys = sqliteTable(
  'question_answer_keys',
  {
    questionId: text('question_id')
      .primaryKey()
      .references(() => questions.id, { onDelete: 'cascade' }),
    correctOptionId: text('correct_option_id')
      .notNull()
      .references(() => questionOptions.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['import', 'editor', 'adjudication'] })
      .notNull()
      .default('import'),
    /** The source JSON's 1-based `correct_option_index`. Audit only. */
    authoredIndex: integer('authored_index'),
    authoredText: text('authored_text'),
    verifiedBy: text('verified_by').references(() => users.id, { onDelete: 'set null' }),
    verifiedAt: integer('verified_at'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  () => [
    check(
      'question_answer_keys_same_question',
      sql`substr(correct_option_id, 1, length(question_id) + 1) = question_id || '#'`
    ),
    check('question_answer_keys_verified', sql`verified_at IS NULL OR verified_by IS NOT NULL`),
  ]
);

/**
 * The shape the delivery path reads. A SQLite view grants nothing -- its value
 * is that it is the shortest correct thing to write, and it cannot reference
 * `question_answer_keys`, so `SELECT *` over it is safe by construction.
 */
export const vQuestionDelivery = sqliteView('v_question_delivery', {
  questionId: text('question_id').notNull(),
  chapterId: text('chapter_id').notNull(),
  subchapterId: text('subchapter_id'),
  stem: text('stem').notNull(),
  stemFormat: text('stem_format').notNull(),
  difficulty: text('difficulty'),
  optionId: text('option_id').notNull(),
  optionOrdinal: integer('option_ordinal').notNull(),
  optionText: text('option_text').notNull(),
  optionTextFormat: text('option_text_format').notNull(),
  optionIsPinned: integer('option_is_pinned').notNull(),
}).existing();

export const explanations = sqliteTable(
  'explanations',
  {
    id: integer('id').primaryKey(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    bodyFormat: text('body_format', { enum: ['plain', 'markdown', 'latex'] })
      .notNull()
      .default('markdown'),
    /** The distractor this paragraph explains, when kind = 'distractor'. */
    aboutOptionId: text('about_option_id').references(() => questionOptions.id, {
      onDelete: 'set null',
    }),
    kind: text('kind', { enum: ['solution', 'distractor', 'hint', 'reference'] })
      .notNull()
      .default('solution'),
    isPrimary: integer('is_primary').notNull().default(0),
    status: text('status', { enum: ['draft', 'published', 'rejected'] })
      .notNull()
      .default('draft'),
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: integer('reviewed_at'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => [
    index('idx_explanations_question_published')
      .on(t.questionId, sql`is_primary DESC`, t.id)
      .where(sql`status = 'published'`),
    uniqueIndex('uq_explanations_primary')
      .on(t.questionId)
      .where(sql`is_primary = 1 AND status = 'published'`),
    index('idx_explanations_draft').on(t.id).where(sql`status = 'draft'`),
    check('explanations_is_primary', sql`is_primary IN (0, 1)`),
    check(
      'explanations_same_question',
      sql`about_option_id IS NULL
         OR substr(about_option_id, 1, length(question_id) + 1) = question_id || '#'`
    ),
    check('explanations_body_nonblank', sql`length(trim(body)) > 0`),
    check('explanations_distractor_target', sql`kind <> 'distractor' OR about_option_id IS NOT NULL`),
  ]
);

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['concept', 'skill', 'exam_year', 'source', 'formula'] })
      .notNull()
      .default('concept'),
    description: text('description'),
    /** Trigger-maintained. See 0005. */
    questionCount: integer('question_count').notNull().default(0),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (t) => [
    index('idx_tags_kind_name').on(t.kind, t.name),
    check('tags_id_slug', sql`id GLOB '[a-z0-9-]*'`),
  ]
);

export const questionTags = sqliteTable(
  'question_tags',
  {
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    /** < 100 means a classifier proposed it and no human confirmed. */
    confidence: integer('confidence').notNull().default(100),
    addedBy: text('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.questionId, t.tagId] }),
    index('idx_question_tags_tag').on(t.tagId, t.questionId),
    check('question_tags_confidence', sql`confidence BETWEEN 0 AND 100`),
  ]
);

/** User-reported errata AND the importer's own validator findings. One object, one queue. */
export const questionReports = sqliteTable(
  'question_reports',
  {
    id: integer('id').primaryKey(),
    publicId: text('public_id').notNull(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    /** NULL for validator/import findings: no human reported them. */
    reporterUserId: text('reporter_user_id').references(() => users.id, { onDelete: 'set null' }),
    source: text('source', { enum: ['user', 'validator', 'import', 'admin'] })
      .notNull()
      .default('user'),
    category: text('category', {
      enum: [
        'wrong_answer',
        'typo',
        'ambiguous',
        'duplicate',
        'out_of_syllabus',
        'bad_option',
        'other',
      ],
    }).notNull(),
    code: text('code', {
      enum: [
        'KEY_CONFLICT',
        'INDEX_RANGE',
        'OPTION_DUPLICATE',
        'OPTION_COUNT',
        'EMPTY_STEM',
        'DUPLICATE_ANSWER_CONFLICT',
        'OPTION_MULTIPLE_TRUE',
      ],
    }),
    detail: text('detail'),
    /** An unadjudicated claim. It must NOT sit in the table the grader reads. */
    suggestedOptionId: text('suggested_option_id').references(() => questionOptions.id, {
      onDelete: 'set null',
    }),
    /** Soft reference to attempts.id -- a report must outlive answer archival. */
    attemptId: integer('attempt_id'),
    status: text('status', { enum: ['open', 'triaged', 'accepted', 'rejected', 'duplicate'] })
      .notNull()
      .default('open'),
    resolution: text('resolution'),
    resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: integer('resolved_at'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('uq_question_reports_public_id').on(t.publicId),
    index('idx_question_reports_open').on(t.createdAt).where(sql`status = 'open'`),
    index('idx_question_reports_question').on(t.questionId, sql`id DESC`),
    uniqueIndex('uq_question_reports_open_by_reporter')
      .on(t.questionId, t.reporterUserId)
      .where(sql`status = 'open' AND reporter_user_id IS NOT NULL`),
    check(
      'question_reports_same_question',
      sql`suggested_option_id IS NULL
         OR substr(suggested_option_id, 1, length(question_id) + 1) = question_id || '#'`
    ),
    check(
      'question_reports_resolved',
      sql`resolved_at IS NULL OR status IN ('accepted', 'rejected', 'duplicate')`
    ),
    check(
      'question_reports_machine_has_no_reporter',
      sql`source NOT IN ('validator', 'import') OR reporter_user_id IS NULL`
    ),
  ]
);

export const contentVersions = sqliteTable(
  'content_versions',
  {
    id: integer('id').primaryKey(),
    entityType: text('entity_type', {
      enum: [
        'question',
        'question_option',
        'question_answer_key',
        'explanation',
        'chapter',
        'subchapter',
        'tag',
        'mock_test_template',
      ],
    }).notNull(),
    entityId: text('entity_id').notNull(),
    version: integer('version').notNull(),
    op: text('op', { enum: ['create', 'update', 'delete', 'status_change'] }).notNull(),
    /** Full post-change state. The question an errata dispute always turns into. */
    snapshotJson: text('snapshot_json').notNull(),
    diffJson: text('diff_json'),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorKind: text('actor_kind', { enum: ['user', 'importer', 'validator', 'system'] })
      .notNull()
      .default('user'),
    reason: text('reason'),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('uq_content_versions_entity_version').on(t.entityType, t.entityId, t.version),
    index('idx_content_versions_actor').on(t.actorUserId, sql`id DESC`),
    check('content_versions_version', sql`version > 0`),
    check('content_versions_snapshot_json', sql`json_valid(snapshot_json)`),
    check('content_versions_diff_json', sql`diff_json IS NULL OR json_valid(diff_json)`),
  ]
);

// ===========================================================================
// 0003_search.sql
// ===========================================================================

/**
 * FTS5 virtual table, maintained by the six triggers in 0003. Declared here
 * only so NQ-11 can be written with typed columns; Drizzle must never be asked
 * to generate DDL for it. `rowid` is kept equal to `questions.rowid` so every
 * trigger deletes by rowid rather than scanning.
 */
export const questionsFts = sqliteTable('questions_fts', {
  rowid: integer('rowid').primaryKey(),
  questionId: text('question_id').notNull(),
  chapterId: text('chapter_id').notNull(),
  status: text('status').notNull(),
  stem: text('stem').notNull(),
  options: text('options').notNull(),
});

// ===========================================================================
// 0004_assessment.sql
// ===========================================================================

export const mockTestTemplates = sqliteTable(
  'mock_test_templates',
  {
    id: text('id').primaryKey(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    durationMinutes: integer('duration_minutes').notNull(),
    totalQuestions: integer('total_questions').notNull(),
    /** TEXT holding JSON. SQLite has no jsonb. Shape documented in 0004. */
    blueprint: text('blueprint', { mode: 'json' }).notNull(),
    selection: text('selection', { enum: ['random', 'static'] })
      .notNull()
      .default('random'),
    status: text('status', { enum: ['draft', 'published', 'retired'] })
      .notNull()
      .default('published'),
    ordinal: integer('ordinal').notNull().default(0),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('uq_mock_test_templates_slug').on(t.slug),
    index('idx_mock_test_templates_subject_ordinal')
      .on(t.subjectId, t.ordinal)
      .where(sql`status = 'published'`),
    check('mock_test_templates_duration', sql`duration_minutes BETWEEN 1 AND 600`),
    check('mock_test_templates_total', sql`total_questions BETWEEN 1 AND 500`),
    check('mock_test_templates_blueprint_json', sql`json_valid(blueprint)`),
    check('mock_test_templates_blueprint_rules', sql`json_type(blueprint, '$.rules') = 'array'`),
    check('mock_test_templates_blueprint_version', sql`json_extract(blueprint, '$.version') = 1`),
  ]
);

/**
 * attempts -- `id` is an INTEGER rowid alias and `publicId` is what appears in
 * URLs. The split exists because every `attemptAnswers` row carries the
 * attempt reference, and that table is unbounded (see 0004).
 */
export const attempts = sqliteTable(
  'attempts',
  {
    id: integer('id').primaryKey(),
    publicId: text('public_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mode: text('mode', {
      enum: ['practice', 'mock', 'srs', 'bookmark_review', 'weak_areas'],
    }).notNull(),
    templateId: text('template_id').references(() => mockTestTemplates.id, {
      onDelete: 'restrict',
    }),
    chapterId: text('chapter_id').references(() => chapters.id, { onDelete: 'restrict' }),
    subchapterId: text('subchapter_id').references(() => subchapters.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['in_progress', 'submitted', 'abandoned', 'expired'] })
      .notNull()
      .default('in_progress'),
    /** Reproduces the exact delivered paper for a dispute. */
    optionSeed: integer('option_seed').notNull(),
    questionCount: integer('question_count').notNull().default(0),
    /** Trigger-maintained (0005), so history survives answer archival. */
    answeredCount: integer('answered_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    /** Basis points, generated STORED. Exact, sortable, indexable. */
    scoreBp: integer('score_bp').generatedAlwaysAs(
      sql`(CASE WHEN question_count = 0 THEN 0 ELSE (correct_count * 10000) / question_count END)`,
      { mode: 'stored' }
    ),
    startedAt: integer('started_at').notNull().default(nowMs),
    /** Server-side clock for a timed mock. The client countdown is a convenience. */
    deadlineAt: integer('deadline_at'),
    submittedAt: integer('submitted_at'),
    elapsedMs: integer('elapsed_ms'),
    /**
     * THE PRE-DEADLINE SNAPSHOT: `{ "<question_id>": "<option_ref>" }`, the
     * last answer map the server accepted strictly before `deadlineAt`.
     *
     * Written only by an UPDATE carrying `AND ?now <= deadline_at`, so its
     * contents are a pre-deadline state by construction, and a CHECK
     * (`last_sync_at <= deadline_at`) makes that the database's rule rather
     * than one handler's. On a submission past the grace window the submitted
     * payload is discarded and THIS is scored, which is what makes freezing
     * the client timer worthless. Without these two columns a late submission
     * could only be zeroed or trusted wholesale, and both are wrong.
     */
    syncedAnswers: text('synced_answers', { mode: 'json' }).$type<Record<string, string>>(),
    lastSyncAt: integer('last_sync_at'),
    clientMeta: text('client_meta', { mode: 'json' }),
  },
  (t) => [
    uniqueIndex('uq_attempts_public_id').on(t.publicId),
    index('idx_attempts_user_in_progress')
      .on(t.userId, sql`started_at DESC`)
      .where(sql`status = 'in_progress'`),
    index('idx_attempts_user_submitted')
      .on(t.userId, sql`submitted_at DESC`)
      .where(sql`status = 'submitted'`),
    index('idx_attempts_deadline')
      .on(t.deadlineAt)
      .where(sql`status = 'in_progress' AND deadline_at IS NOT NULL`),
    index('idx_attempts_submitted_at').on(t.submittedAt).where(sql`submitted_at IS NOT NULL`),
    check('attempts_question_count', sql`question_count >= 0`),
    check('attempts_answered_count', sql`answered_count >= 0`),
    check('attempts_correct_count', sql`correct_count >= 0`),
    check('attempts_client_meta_json', sql`client_meta IS NULL OR json_valid(client_meta)`),
    check('attempts_correct_le_answered', sql`correct_count <= answered_count`),
    check('attempts_answered_le_total', sql`answered_count <= question_count`),
    check('attempts_submitted_at', sql`(status = 'submitted') = (submitted_at IS NOT NULL)`),
    check('attempts_mock_needs_template', sql`mode <> 'mock' OR template_id IS NOT NULL`),
    check('attempts_subchapter_needs_chapter', sql`subchapter_id IS NULL OR chapter_id IS NOT NULL`),
    check('attempts_sync_pair', sql`(synced_answers IS NULL) = (last_sync_at IS NULL)`),
    check(
      'attempts_sync_before_deadline',
      sql`last_sync_at IS NULL OR deadline_at IS NULL OR last_sync_at <= deadline_at`
    ),
  ]
);

/**
 * attempt_questions -- the delivered paper. `optionOrder` is a JSON array of
 * OPTION IDS in the order this attempt showed them; ids, never indices,
 * because joining an index against the public JSON bank in git history is the
 * attack being closed.
 */
export const attemptQuestions = sqliteTable(
  'attempt_questions',
  {
    attemptId: integer('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'restrict' }),
    optionOrder: text('option_order', { mode: 'json' }).notNull().$type<string[]>(),
  },
  (t) => [
    primaryKey({ columns: [t.attemptId, t.position] }),
    uniqueIndex('uq_attempt_questions_attempt_question').on(t.attemptId, t.questionId),
    check('attempt_questions_position', sql`position >= 1`),
    check(
      'attempt_questions_option_order_json',
      sql`json_valid(option_order) AND json_type(option_order) = 'array'`
    ),
  ]
);

/**
 * attempt_answers -- THE ONLY UNBOUNDED TABLE ON THE PLATFORM. Measured at
 * 132.4 bytes/row including its three indexes; ~3.9 M rows fit a 500 MB D1
 * free database. Read the archival note in 0004 before adding a column, and
 * NEVER add a DELETE trigger: archival deletes millions of these rows and a
 * delete trigger on the rollups would erase every student's progress.
 */
export const attemptAnswers = sqliteTable(
  'attempt_answers',
  {
    /** rowid alias, and the archival cursor (rowid order is insertion order). */
    id: integer('id').primaryKey(),
    attemptId: integer('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'restrict' }),
    /** NULL = skipped. `questionOptions.optKey`, 12 base32 chars. */
    selectedOptKey: text('selected_opt_key'),
    /** VIRTUAL: zero bytes on disk, fully joinable. The stable option id, literally. */
    selectedOptionId: text('selected_option_id').generatedAlwaysAs(
      sql`(CASE WHEN selected_opt_key IS NULL THEN NULL
                ELSE question_id || '#' || selected_opt_key END)`,
      { mode: 'virtual' }
    ),
    /** Graded server-side at write time against questionAnswerKeys, then stored. */
    isCorrect: integer('is_correct').notNull().default(0),
    /** Screen position under this attempt's permutation. Analytics only, never grading. */
    deliveredPosition: integer('delivered_position'),
    timeMs: integer('time_ms'),
    revised: integer('revised').notNull().default(0),
    answeredAt: integer('answered_at').notNull().default(nowMs),
  },
  (t) => [
    /**
     * Proves the chosen key is a real option of that question. One index probe
     * per insert, paid deliberately: an answer pointing at a nonexistent option
     * is an unfixable silent mis-grade. SQLite skips the check when
     * `selectedOptKey` is NULL, so a skipped answer costs nothing.
     */
    foreignKey({
      columns: [t.questionId, t.selectedOptKey],
      foreignColumns: [questionOptions.questionId, questionOptions.optKey],
      name: 'fk_attempt_answers_question_option',
    }),
    uniqueIndex('uq_attempt_answers_attempt_question').on(t.attemptId, t.questionId),
    index('idx_attempt_answers_answered_at').on(t.answeredAt),
    index('idx_attempt_answers_question_correct').on(t.questionId, t.isCorrect),
    check('attempt_answers_is_correct', sql`is_correct IN (0, 1)`),
    check('attempt_answers_time_ms', sql`time_ms IS NULL OR time_ms >= 0`),
    check('attempt_answers_revised', sql`revised IN (0, 1)`),
    check(
      'attempt_answers_opt_key_shape',
      sql`selected_opt_key IS NULL
         OR (length(selected_opt_key) = 12 AND selected_opt_key GLOB '[0-9A-Z]*')`
    ),
    check('attempt_answers_skipped_is_wrong', sql`selected_opt_key IS NOT NULL OR is_correct = 0`),
  ]
);

/**
 * Staging area for the retention job, in the SAME database -- so moving rows
 * here frees NO space. The DELETE in 0004 step 2 is what reclaims pages, and
 * the job that drains this to R2 is what makes the ceiling arithmetic true.
 */
export const attemptAnswersArchive = sqliteTable(
  'attempt_answers_archive',
  {
    id: integer('id').primaryKey(),
    /** Soft reference: the point of an archive row is to outlive its parents. */
    attemptId: integer('attempt_id').notNull(),
    /** Denormalised, because the attempt may already be gone. */
    userId: text('user_id').notNull(),
    questionId: text('question_id').notNull(),
    selectedOptKey: text('selected_opt_key'),
    isCorrect: integer('is_correct').notNull(),
    deliveredPosition: integer('delivered_position'),
    timeMs: integer('time_ms'),
    answeredAt: integer('answered_at').notNull(),
    archivedAt: integer('archived_at').notNull().default(nowMs),
    /** NULL means this row is still only in D1 and deleting it would lose data. */
    r2ObjectKey: text('r2_object_key'),
  },
  (t) => [
    index('idx_attempt_answers_archive_undrained').on(t.id).where(sql`r2_object_key IS NULL`),
    check('attempt_answers_archive_is_correct', sql`is_correct IN (0, 1)`),
  ]
);

// ===========================================================================
// 0005_learning.sql
// ===========================================================================

export const bookmarks = sqliteTable(
  'bookmarks',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    note: text('note'),
    folder: text('folder'),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.questionId] }),
    index('idx_bookmarks_user_created').on(t.userId, sql`created_at DESC`),
    index('idx_bookmarks_user_folder').on(t.userId, t.folder).where(sql`folder IS NOT NULL`),
  ]
);

/**
 * One FSRS card per (user, question). Column names and units are FSRS's so the
 * open-source scheduler drops in without a translation layer. Scheduling runs
 * in the Worker -- FSRS needs pow/exp and D1 does not guarantee SQLite's math
 * functions.
 */
export const srsState = sqliteTable(
  'srs_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    /** Days until recall probability decays to 90%. */
    stability: real('stability').notNull().default(0),
    /** 1..10, intrinsic to the item for this user. */
    difficulty: real('difficulty').notNull().default(5),
    elapsedDays: real('elapsed_days').notNull().default(0),
    scheduledDays: real('scheduled_days').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    /** 0 New, 1 Learning, 2 Review, 3 Relearning. */
    state: integer('state').notNull().default(0),
    due: integer('due').notNull(),
    lastReview: integer('last_review'),
    /** 1..4 = Again, Hard, Good, Easy. */
    lastRating: integer('last_rating'),
    suspendedAt: integer('suspended_at'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.questionId] }),
    index('idx_srs_state_user_due').on(t.userId, t.due).where(sql`suspended_at IS NULL`),
    check('srs_state_stability', sql`stability >= 0.0`),
    check('srs_state_difficulty', sql`difficulty BETWEEN 1.0 AND 10.0`),
    check('srs_state_elapsed_days', sql`elapsed_days >= 0.0`),
    check('srs_state_scheduled_days', sql`scheduled_days >= 0.0`),
    check('srs_state_reps', sql`reps >= 0`),
    check('srs_state_lapses', sql`lapses >= 0`),
    check('srs_state_state', sql`state IN (0, 1, 2, 3)`),
    check('srs_state_last_rating', sql`last_rating IS NULL OR last_rating BETWEEN 1 AND 4`),
    check('srs_state_lapses_le_reps', sql`lapses <= reps`),
    check('srs_state_reps_need_review', sql`reps = 0 OR last_review IS NOT NULL`),
  ]
);

/** Wall-clock engagement, distinct from an `attempt` (a graded artefact). */
export const studySessions = sqliteTable(
  'study_sessions',
  {
    id: integer('id').primaryKey(),
    publicId: text('public_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['practice', 'mock', 'review', 'srs', 'reading'] }).notNull(),
    chapterId: text('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    subchapterId: text('subchapter_id').references(() => subchapters.id, { onDelete: 'set null' }),
    /** Soft reference to attempts.id: activity history must outlive an attempt. */
    attemptId: integer('attempt_id'),
    startedAt: integer('started_at').notNull().default(nowMs),
    endedAt: integer('ended_at'),
    /** Generated, so "time studied" is never a client-supplied number. */
    durationS: integer('duration_s').generatedAlwaysAs(
      sql`(CASE WHEN ended_at IS NULL THEN 0 ELSE (ended_at - started_at) / 1000 END)`,
      { mode: 'stored' }
    ),
    questionsSeen: integer('questions_seen').notNull().default(0),
    questionsCorrect: integer('questions_correct').notNull().default(0),
    /** TEXT 'YYYY-MM-DD' in the USER's timezone, written by the API. Never UTC. */
    localDate: text('local_date').notNull(),
  },
  (t) => [
    uniqueIndex('uq_study_sessions_public_id').on(t.publicId),
    index('idx_study_sessions_user_started').on(t.userId, sql`started_at DESC`),
    index('idx_study_sessions_user_local_date').on(
      t.userId,
      t.localDate,
      t.durationS,
      t.questionsSeen
    ),
    index('idx_study_sessions_open').on(t.userId, sql`started_at DESC`).where(sql`ended_at IS NULL`),
    check('study_sessions_questions_seen', sql`questions_seen >= 0`),
    check('study_sessions_questions_correct', sql`questions_correct >= 0`),
    check(
      'study_sessions_local_date',
      sql`local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
    ),
    check('study_sessions_correct_le_seen', sql`questions_correct <= questions_seen`),
    check('study_sessions_end_after_start', sql`ended_at IS NULL OR ended_at >= started_at`),
  ]
);

/**
 * One row per user. `lastActiveDate` is a calendar day in the USER's timezone,
 * not a timestamp -- a streak is a statement about days, and UTC midnight is
 * nobody's day boundary. Maintained by the API (NQ-32a); `longestLength` is
 * ratcheted by a trigger so the caller cannot get that arithmetic wrong.
 */
export const streaks = sqliteTable(
  'streaks',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    currentLength: integer('current_length').notNull().default(0),
    longestLength: integer('longest_length').notNull().default(0),
    lastActiveDate: text('last_active_date'),
    totalActiveDays: integer('total_active_days').notNull().default(0),
    /** A one-day grace token, so one missed day does not erase six weeks. */
    freezesAvailable: integer('freezes_available').notNull().default(0),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  () => [
    index('idx_streaks_current_length').on(sql`current_length DESC`).where(sql`current_length > 0`),
    check('streaks_current_length', sql`current_length >= 0`),
    check('streaks_longest_length', sql`longest_length >= 0`),
    check(
      'streaks_last_active_date',
      sql`last_active_date IS NULL
                                   OR last_active_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
    ),
    check('streaks_total_active_days', sql`total_active_days >= 0`),
    check('streaks_freezes', sql`freezes_available BETWEEN 0 AND 3`),
    check('streaks_current_le_total', sql`current_length <= total_active_days`),
  ]
);

/**
 * The rollup the progress page reads (NQ-27: one covering index range scan,
 * no join, ten groups). `chapterId` and `subchapterId` are denormalised from
 * `questions` by the trigger precisely so that read needs no join.
 *
 * THERE IS NO DELETE TRIGGER ON attemptAnswers, and there must never be:
 * archival deletes millions of answer rows, and a delete trigger that
 * decremented these counters would erase every student's progress the first
 * night the retention job ran.
 */
export const userQuestionStats = sqliteTable(
  'user_question_stats',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id').notNull(),
    subchapterId: text('subchapter_id'),
    /** Times shown, including skips. */
    exposureCount: integer('exposure_count').notNull().default(0),
    /** Times an option was actually chosen. */
    answerCount: integer('answer_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    consecutiveCorrect: integer('consecutive_correct').notNull().default(0),
    /** Basis points, generated STORED -- the sort key for the weak-areas queue. */
    accuracyBp: integer('accuracy_bp').generatedAlwaysAs(
      sql`(CASE WHEN answer_count = 0 THEN 0 ELSE (correct_count * 10000) / answer_count END)`,
      { mode: 'stored' }
    ),
    firstAnsweredAt: integer('first_answered_at'),
    lastAnsweredAt: integer('last_answered_at'),
    lastIsCorrect: integer('last_is_correct'),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.questionId] }),
    index('idx_user_question_stats_user_chapter').on(
      t.userId,
      t.chapterId,
      t.correctCount,
      t.answerCount
    ),
    index('idx_user_question_stats_user_subchapter')
      .on(t.userId, t.subchapterId, t.correctCount, t.answerCount)
      .where(sql`subchapter_id IS NOT NULL`),
    index('idx_user_question_stats_user_accuracy')
      .on(t.userId, t.accuracyBp, t.lastAnsweredAt)
      .where(sql`answer_count > 0`),
    index('idx_user_question_stats_question').on(t.questionId),
    check('user_question_stats_exposure_count', sql`exposure_count >= 0`),
    check('user_question_stats_answer_count', sql`answer_count >= 0`),
    check('user_question_stats_correct_count', sql`correct_count >= 0`),
    check('user_question_stats_consecutive_correct', sql`consecutive_correct >= 0`),
    check('user_question_stats_last_is_correct', sql`last_is_correct IS NULL OR last_is_correct IN (0, 1)`),
    check('user_question_stats_answer_le_exposure', sql`answer_count <= exposure_count`),
    check('user_question_stats_correct_le_answer', sql`correct_count <= answer_count`),
    check('user_question_stats_consecutive_le_correct', sql`consecutive_correct <= correct_count`),
  ]
);

// ===========================================================================
// 0006_engagement.sql
// ===========================================================================

/**
 * Precomputed leaderboards. NEVER aggregate `attemptAnswers` live: D1 is
 * single-threaded per database, so one such scan blocks every write behind it,
 * bills millions of row reads per page view, and stops being correct the
 * moment archival runs.
 */
export const leaderboardSnapshots = sqliteTable(
  'leaderboard_snapshots',
  {
    id: integer('id').primaryKey(),
    scope: text('scope', { enum: ['global', 'chapter', 'subchapter', 'template'] }).notNull(),
    /** '' for global -- empty string, not NULL, so the unique index below works. */
    scopeRef: text('scope_ref').notNull().default(''),
    period: text('period', { enum: ['daily', 'weekly', 'monthly', 'all_time'] }).notNull(),
    /** 'YYYY-MM-DD'. 'all_time' uses '0001-01-01'. */
    periodStart: text('period_start').notNull(),
    metric: text('metric', {
      enum: [
        'correct_answers',
        'accuracy_bp',
        'questions_answered',
        'streak_length',
        'mock_score_bp',
      ],
    })
      .notNull()
      .default('correct_answers'),
    /** Rendered top-N with display fields denormalised, so the page is one query. */
    topJson: text('top_json', { mode: 'json' }).notNull(),
    entrantCount: integer('entrant_count').notNull().default(0),
    computedAt: integer('computed_at').notNull().default(nowMs),
    /** How long the snapshot took. The day this gets slow, revisit 0004's arithmetic. */
    computeMs: integer('compute_ms'),
  },
  (t) => [
    uniqueIndex('uq_leaderboard_snapshots_scope_period').on(
      t.scope,
      t.scopeRef,
      t.period,
      t.periodStart
    ),
    index('idx_leaderboard_snapshots_computed_at').on(t.computedAt),
    check(
      'leaderboard_snapshots_period_start',
      sql`period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
    ),
    check(
      'leaderboard_snapshots_top_json',
      sql`json_valid(top_json) AND json_type(top_json) = 'array'`
    ),
    check('leaderboard_snapshots_entrant_count', sql`entrant_count >= 0`),
    check(
      'leaderboard_snapshots_all_time',
      sql`period = 'all_time' OR period_start <> '0001-01-01'`
    ),
    check('leaderboard_snapshots_scope_ref', sql`(scope = 'global') = (scope_ref = '')`),
  ]
);

export const leaderboardEntries = sqliteTable(
  'leaderboard_entries',
  {
    /** leaderboard_snapshots.id, deliberately NOT a foreign key (see 0006 NQ-35d). */
    snapshotId: integer('snapshot_id').notNull(),
    rank: integer('rank').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    accuracyBp: integer('accuracy_bp'),
    /** Rank in the previous snapshot, so the UI shows movement without a second read. */
    prevRank: integer('prev_rank'),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.rank] }),
    uniqueIndex('uq_leaderboard_entries_snapshot_user').on(t.snapshotId, t.userId),
    index('idx_leaderboard_entries_user').on(t.userId),
    check('leaderboard_entries_rank', sql`rank >= 1`),
    check(
      'leaderboard_entries_accuracy_bp',
      sql`accuracy_bp IS NULL OR accuracy_bp BETWEEN 0 AND 10000`
    ),
    check('leaderboard_entries_prev_rank', sql`prev_rank IS NULL OR prev_rank >= 1`),
  ]
);

export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: [
        'streak_risk',
        'streak_milestone',
        'srs_due',
        'mock_result',
        'report_resolved',
        'contribution_reviewed',
        'leaderboard_move',
        'announcement',
      ],
    }).notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    dataJson: text('data_json', { mode: 'json' }),
    readAt: integer('read_at'),
    createdAt: integer('created_at').notNull().default(nowMs),
    expiresAt: integer('expires_at'),
    /**
     * Idempotency key, e.g. 'srs_due:2026-10-20'. The upsert MUST restate the
     * partial predicate -- `ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key
     * IS NOT NULL DO NOTHING` -- or prepare() fails at runtime.
     */
    dedupeKey: text('dedupe_key'),
  },
  (t) => [
    index('idx_notifications_user_unread')
      .on(t.userId, sql`created_at DESC`)
      .where(sql`read_at IS NULL`),
    index('idx_notifications_user').on(t.userId, sql`id DESC`),
    uniqueIndex('uq_notifications_user_dedupe')
      .on(t.userId, t.dedupeKey)
      .where(sql`dedupe_key IS NOT NULL`),
    index('idx_notifications_expires_at').on(t.expiresAt).where(sql`expires_at IS NOT NULL`),
    check('notifications_data_json', sql`data_json IS NULL OR json_valid(data_json)`),
    check('notifications_title_nonblank', sql`length(trim(title)) > 0`),
    check('notifications_expires_after_created', sql`expires_at IS NULL OR expires_at > created_at`),
  ]
);

// ===========================================================================
// 0008_api_infrastructure.sql
// ===========================================================================

/**
 * The offline-replay contract. Keyed by `(userId, key)` because clients mint
 * these themselves, so a global key space would let one user's key collide
 * with -- or read back -- another user's stored response.
 *
 * A NULL `responseJson` is a RESERVATION, not a result: the handler claimed the
 * key and is still working, and a concurrent duplicate gets 409
 * REQUEST_IN_FLIGHT rather than scoring the same attempt twice.
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    endpoint: text('endpoint').notNull(),
    /** sha256 of endpoint + canonicalised body, minus the key itself. */
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code'),
    responseJson: text('response_json', { mode: 'json' }),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index('idx_idempotency_keys_created_at').on(t.createdAt),
    check('idempotency_keys_key_length', sql`length(key) BETWEEN 8 AND 80`),
    check(
      'idempotency_keys_request_hash',
      sql`length(request_hash) = 64 AND request_hash GLOB '[0-9a-f]*'`
    ),
    check(
      'idempotency_keys_status_code',
      sql`status_code IS NULL OR status_code BETWEEN 100 AND 599`
    ),
    check(
      'idempotency_keys_response_json',
      sql`response_json IS NULL OR json_valid(response_json)`
    ),
    check('idempotency_keys_pair', sql`(status_code IS NULL) = (response_json IS NULL)`),
  ]
);

/**
 * Fixed-window counters. BEST-EFFORT BY CONSTRUCTION: D1 replicates
 * asynchronously, so the effective limit is "roughly `limit` per window PER
 * REGION". Adequate for credential stuffing and submit abuse; not a substitute
 * for a Durable Object. `bucket` is `<rule>:<subject>` and the subject is a
 * user id or a HASHED address -- this is a counter, not a log.
 */
export const rateLimits = sqliteTable(
  'rate_limits',
  {
    bucket: text('bucket').primaryKey(),
    /** `floor(now / windowMs) * windowMs`, so two Workers agree on the boundary. */
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    index('idx_rate_limits_window_start').on(t.windowStart),
    check('rate_limits_count', sql`count >= 0`),
    check('rate_limits_bucket_length', sql`length(bucket) BETWEEN 3 AND 160`),
  ]
);

// ---------------------------------------------------------------------------
// Inferred row types. Handlers should use these rather than hand-written
// interfaces, so a column rename is a compile error.
// ---------------------------------------------------------------------------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type Subchapter = typeof subchapters.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type QuestionOption = typeof questionOptions.$inferSelect;
/** SERVER-ONLY. Never serialise this type into a pre-submit response. */
export type QuestionAnswerKey = typeof questionAnswerKeys.$inferSelect;
export type Explanation = typeof explanations.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type QuestionReport = typeof questionReports.$inferSelect;
export type ContentVersion = typeof contentVersions.$inferSelect;
export type MockTestTemplate = typeof mockTestTemplates.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;
export type AttemptQuestion = typeof attemptQuestions.$inferSelect;
export type AttemptAnswer = typeof attemptAnswers.$inferSelect;
export type Bookmark = typeof bookmarks.$inferSelect;
export type SrsState = typeof srsState.$inferSelect;
export type StudySession = typeof studySessions.$inferSelect;
export type Streak = typeof streaks.$inferSelect;
export type UserQuestionStat = typeof userQuestionStats.$inferSelect;
export type LeaderboardSnapshot = typeof leaderboardSnapshots.$inferSelect;
export type LeaderboardEntry = typeof leaderboardEntries.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AdminAuditLogRow = typeof adminAuditLog.$inferSelect;
export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type OAuthState = typeof oauthStates.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type RateLimit = typeof rateLimits.$inferSelect;

/**
 * The delivery projection. Note it has no `correctOptionId` field, and cannot:
 * the view it reads does not join the key table.
 */
export type DeliveredQuestionRow = {
  questionId: string;
  chapterId: string;
  subchapterId: string | null;
  stem: string;
  stemFormat: string;
  difficulty: string | null;
  optionId: string;
  optionOrdinal: number;
  optionText: string;
  optionTextFormat: string;
  optionIsPinned: number;
};
