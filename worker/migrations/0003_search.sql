-- 0003_search.sql
-- Full-text search over the question bank.
--
-- SQLite has no trigram index, no tsvector and no pg_trgm. It has FTS5, which
-- D1 supports. A LIKE '%...%' scan over 2,290 questions would work today and
-- stop working at 50,000; FTS5 costs one extra index now and nothing later.
--
-- Shape: a standalone (not external-content) FTS5 table whose rowid is kept
-- equal to `questions.rowid`. Standalone means the indexed text is stored
-- twice -- about 1.3 MB of stems and options becomes roughly 3 MB total, which
-- is a real cost against a 500 MB free-tier ceiling and is accepted because
-- the alternatives all require the triggers to carry the OLD row's full text
-- through every update, which is exactly the kind of bookkeeping that rots.
--
-- Keying the FTS rowid to `questions.rowid` is what makes maintenance cheap:
-- every trigger below deletes by rowid (an O(log n) lookup) instead of by
-- `question_id` (a full scan of the FTS content table on every option edit,
-- which is fine at 2,290 questions and ruinous at 100,000).
--
-- `options` is denormalised into the index on purpose. Students search for the
-- text of an answer they half-remember at least as often as for the stem.
--
-- `tokenize = 'porter unicode61'` so 'resonating' finds 'resonance'. The
-- bank is English with embedded code and formulae; `unicode61` keeps
-- '74LS138' and 'CSMA/CD' searchable as units.

CREATE VIRTUAL TABLE questions_fts USING fts5(
  question_id UNINDEXED,
  chapter_id  UNINDEXED,
  status      UNINDEXED,
  stem,
  options,
  tokenize = 'porter unicode61'
);

-- ---------------------------------------------------------------------------
-- Maintenance triggers.
--
-- These are triggers rather than application code for a reason specific to
-- this platform: D1 allows 50 queries per Worker invocation on the free plan.
-- A content edit that had to hand-maintain the search index would spend two of
-- those on bookkeeping. Work done inside a trigger is part of the statement
-- that fired it and does not count against that budget.
-- ---------------------------------------------------------------------------

CREATE TRIGGER questions_fts_ai AFTER INSERT ON questions BEGIN
  INSERT INTO questions_fts (rowid, question_id, chapter_id, status, stem, options)
  VALUES (
    NEW.rowid, NEW.id, NEW.chapter_id, NEW.status, NEW.stem,
    -- Empty at import time: the importer writes the question before its
    -- options. The question_options triggers below refresh the row.
    COALESCE((SELECT group_concat(text, ' ')
                FROM question_options
               WHERE question_id = NEW.id AND retired_at IS NULL), '')
  );
END;

CREATE TRIGGER questions_fts_ad AFTER DELETE ON questions BEGIN
  DELETE FROM questions_fts WHERE rowid = OLD.rowid;
END;

-- Scoped to the columns the index actually holds, so the hourly
-- `UPDATE questions SET p_value_bp = ...` statistics job does not reindex the
-- entire bank.
CREATE TRIGGER questions_fts_au
AFTER UPDATE OF stem, status, chapter_id ON questions BEGIN
  DELETE FROM questions_fts WHERE rowid = OLD.rowid;
  INSERT INTO questions_fts (rowid, question_id, chapter_id, status, stem, options)
  VALUES (
    NEW.rowid, NEW.id, NEW.chapter_id, NEW.status, NEW.stem,
    COALESCE((SELECT group_concat(text, ' ')
                FROM question_options
               WHERE question_id = NEW.id AND retired_at IS NULL), '')
  );
END;

-- Option changes refresh the parent question's single FTS row. One delete and
-- one insert, both by rowid.
CREATE TRIGGER question_options_fts_ai AFTER INSERT ON question_options BEGIN
  DELETE FROM questions_fts
   WHERE rowid = (SELECT rowid FROM questions WHERE id = NEW.question_id);
  INSERT INTO questions_fts (rowid, question_id, chapter_id, status, stem, options)
  SELECT q.rowid, q.id, q.chapter_id, q.status, q.stem,
         COALESCE((SELECT group_concat(o.text, ' ')
                     FROM question_options o
                    WHERE o.question_id = q.id AND o.retired_at IS NULL), '')
    FROM questions q WHERE q.id = NEW.question_id;
END;

CREATE TRIGGER question_options_fts_au
AFTER UPDATE OF text, retired_at ON question_options BEGIN
  DELETE FROM questions_fts
   WHERE rowid = (SELECT rowid FROM questions WHERE id = NEW.question_id);
  INSERT INTO questions_fts (rowid, question_id, chapter_id, status, stem, options)
  SELECT q.rowid, q.id, q.chapter_id, q.status, q.stem,
         COALESCE((SELECT group_concat(o.text, ' ')
                     FROM question_options o
                    WHERE o.question_id = q.id AND o.retired_at IS NULL), '')
    FROM questions q WHERE q.id = NEW.question_id;
END;

-- Option rows are retired, not deleted (see 0002). This trigger exists for the
-- one legitimate delete path: cascading removal of a question that nobody has
-- answered. The parent question row is gone by the time it fires in that case,
-- so the SELECT yields nothing and only the DELETE does work -- which is
-- correct, and is why the INSERT is a SELECT rather than a VALUES.
CREATE TRIGGER question_options_fts_ad AFTER DELETE ON question_options BEGIN
  DELETE FROM questions_fts
   WHERE rowid = (SELECT rowid FROM questions WHERE id = OLD.question_id);
  INSERT INTO questions_fts (rowid, question_id, chapter_id, status, stem, options)
  SELECT q.rowid, q.id, q.chapter_id, q.status, q.stem,
         COALESCE((SELECT group_concat(o.text, ' ')
                     FROM question_options o
                    WHERE o.question_id = q.id AND o.retired_at IS NULL), '')
    FROM questions q WHERE q.id = OLD.question_id;
END;

-- ---------------------------------------------------------------------------
-- NQ-11 question-search (student-facing). `status` is an UNINDEXED column of
-- the FTS table so it can be filtered without a join back to `questions`,
-- keeping the whole search to one query:
--
--   SELECT question_id, chapter_id,
--          snippet(questions_fts, 3, '<mark>', '</mark>', '...', 24) AS excerpt,
--          bm25(questions_fts, 0.0, 0.0, 0.0, 10.0, 3.0) AS rank
--     FROM questions_fts
--    WHERE questions_fts MATCH ?1
--      AND status = 'published'
--    ORDER BY rank
--    LIMIT ?2;
--
-- The bm25 weights are positional over the table's five columns: the three
-- UNINDEXED ones get 0.0, a stem hit is weighted 10 and an option hit 3. A
-- student searching 'Thevenin' wants the question about Thevenin's theorem
-- ahead of one that merely lists it as a wrong answer.
--
-- NQ-11b admin-search is the same query without the status filter.
--
-- NQ-11c index-rebuild, after a bulk import or a tokenizer change:
--   INSERT INTO questions_fts (questions_fts) VALUES ('rebuild');
-- -- not usable here, because 'rebuild' is only defined for external-content
--    tables. The standalone equivalent is:
--   DELETE FROM questions_fts;
--   INSERT INTO questions_fts (rowid, question_id, chapter_id, status, stem, options)
--   SELECT q.rowid, q.id, q.chapter_id, q.status, q.stem,
--          COALESCE((SELECT group_concat(o.text, ' ') FROM question_options o
--                     WHERE o.question_id = q.id AND o.retired_at IS NULL), '')
--     FROM questions q;
--
-- NQ-11d index-compact, cheap and worth running after a bulk import because
-- D1 never shrinks a database file and FTS5 segment merging is the only
-- compaction available:
--   INSERT INTO questions_fts (questions_fts, rank) VALUES ('merge', -64);
-- ---------------------------------------------------------------------------
