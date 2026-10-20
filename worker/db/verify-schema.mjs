#!/usr/bin/env node
/**
 * verify-schema.mjs -- prove that db/schema.ts and worker/migrations/*.sql
 * describe the same database.
 *
 * The migrations are the source of truth; the Drizzle file is a typed client.
 * Two hand-maintained descriptions of one schema is normally a liability, and
 * this script is what makes it safe: it introspects a freshly migrated
 * database and fails if the two have drifted, so the duplication cannot rot
 * quietly between them.
 *
 * It checks, in both directions:
 *
 *   * tables            -- present in SQL and in TS, nothing extra either side
 *   * columns           -- names, nullability, primary-key membership
 *   * generated columns -- which ones, and stored vs virtual
 *   * indexes           -- names, key columns, uniqueness, partial-ness
 *   * foreign keys      -- (child columns, parent table, parent columns, ON DELETE)
 *   * enums             -- the TS literal union against the SQL CHECK ... IN (...)
 *
 * That last one matters most. Drizzle's `{ enum: [...] }` is types-only for
 * SQLite: the runtime constraint is the CHECK in the migration. Without this
 * check, adding a value to one and not the other produces either a TypeScript
 * type that lies or a database that rejects a value the compiler blessed.
 *
 * Runs db/schema.ts directly through Node's type stripping (Node 22+), so
 * there is no build step and no tsc in the loop.
 *
 * Usage: node db/verify-schema.mjs [--db <path>] [--verbose]
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getTableConfig, getViewConfig } from 'drizzle-orm/sqlite-core';
import { is } from 'drizzle-orm';
import { SQLiteTable, SQLiteView } from 'drizzle-orm/sqlite-core';

const WORKER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `d1_migrations` belongs to wrangler's migration runner, not to this schema. */
const SQL_ONLY_TABLES = new Set(['d1_migrations']);

/**
 * FTS5 shadow tables (questions_fts_data, _idx, _docsize, _config) are engine
 * internals. The virtual table `questions_fts` itself is NOT internal: it is
 * declared in schema.ts so NQ-11 can be written with typed columns, and its
 * existence is checked -- but its column and index shape is FTS5's business,
 * not Drizzle's, so structural comparison is skipped for it.
 */
const isFtsShadow = (name) => /^questions_fts_/.test(name);
const isVirtual = (ddl) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(ddl ?? '');

const problems = [];
const notes = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

function sqlTables(db) {
  return db
    .prepare(
      `SELECT name, sql FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`
    )
    .all()
    .filter((t) => !SQL_ONLY_TABLES.has(t.name) && !isFtsShadow(t.name));
}

function sqlColumns(db, table) {
  // table_xinfo includes generated columns; table_info does not.
  return db.prepare(`SELECT * FROM pragma_table_xinfo(?)`).all(table);
}

function sqlIndexes(db, table) {
  return db
    .prepare(
      `SELECT name, sql FROM sqlite_master
        WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
        ORDER BY name`
    )
    .all(table)
    .map((idx) => ({
      name: idx.name,
      unique: /CREATE\s+UNIQUE\s+INDEX/i.test(idx.sql),
      partial: /\)\s*WHERE\s/i.test(idx.sql),
      // Key columns as written, lowercased, with DESC/ASC kept: 'DESC' is part
      // of the index's identity and Drizzle cannot express it in .on(column)
      // form, which is exactly the kind of difference this must catch.
      keys: indexKeyColumns(idx.sql),
    }));
}

/**
 * The key columns of a CREATE INDEX, as written.
 *
 * Parsed by walking balanced parentheses rather than by slicing to the last
 * ')': a partial index's WHERE clause contains both parentheses and commas
 * (`WHERE status IN ('draft', 'flagged')`), and a naive slice folds that
 * predicate into the key list.
 *
 * DESC/ASC is kept. It is part of the index's identity, Drizzle cannot express
 * it in `.on(column)` form, and silently losing it would turn a no-sort index
 * scan into a sort -- exactly the regression this verifier exists to catch.
 */
function indexKeyColumns(ddl) {
  const start = ddl.indexOf('(');
  if (start < 0) return [];
  let depth = 0;
  let end = -1;
  for (let i = start; i < ddl.length; i++) {
    if (ddl[i] === '(') depth++;
    else if (ddl[i] === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];
  // Split on top-level commas only, so a key expression containing its own
  // parentheses stays in one piece.
  const inner = ddl.slice(start + 1, end);
  const parts = [];
  let buf = '';
  depth = 0;
  for (const ch of inner) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts.map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function sqlForeignKeys(db, table) {
  const rows = db.prepare(`SELECT * FROM pragma_foreign_key_list(?)`).all(table);
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) byId.set(r.id, { table: r.table, from: [], to: [], onDelete: r.on_delete });
    byId.get(r.id).from.push(r.from);
    byId.get(r.id).to.push(r.to);
  }
  return [...byId.values()].map(
    (fk) =>
      `${fk.from.join('+')} -> ${fk.table}(${fk.to.join('+')}) ON DELETE ${fk.onDelete.toUpperCase()}`
  );
}

/**
 * Pulls the value list out of a `... <column> IN ('a', 'b')` CHECK in the
 * table DDL. Returns null when the column has no such CHECK, which is itself
 * a finding when the TS side declares an enum.
 */
function sqlEnumValues(tableSql, column) {
  const re = new RegExp(`\\b${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i');
  const m = tableSql.match(re);
  if (!m) return null;
  const values = [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((v) => v[1].replace(/''/g, "'"));
  return values.length ? values : null;
}

export async function verify(db, { verbose = false } = {}) {
  const schema = await import(pathToFileURL(join(WORKER_ROOT, 'db', 'schema.ts')).href);

  const tsTables = new Map();
  const tsViews = new Map();
  for (const value of Object.values(schema)) {
    if (is(value, SQLiteTable)) {
      const cfg = getTableConfig(value);
      tsTables.set(cfg.name, cfg);
    } else if (is(value, SQLiteView)) {
      tsViews.set(getViewConfig(value).name, value);
    }
  }

  const dbTables = sqlTables(db);
  const dbTableNames = new Set(dbTables.map((t) => t.name));

  // ---- table presence, both directions -----------------------------------
  for (const name of dbTableNames) {
    if (!tsTables.has(name)) fail('tables', `${name} exists in SQL but not in schema.ts`);
  }
  for (const name of tsTables.keys()) {
    if (!dbTableNames.has(name)) fail('tables', `${name} exists in schema.ts but not in SQL`);
  }

  const dbViews = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name`)
    .all()
    .map((r) => r.name);
  for (const name of dbViews) {
    if (!tsViews.has(name)) fail('views', `${name} exists in SQL but not in schema.ts`);
  }
  for (const name of tsViews.keys()) {
    if (!dbViews.includes(name)) fail('views', `${name} exists in schema.ts but not in SQL`);
  }

  let columnsChecked = 0;
  let indexesChecked = 0;
  let enumsChecked = 0;
  let fksChecked = 0;

  for (const { name: table, sql: tableSql } of dbTables) {
    const cfg = tsTables.get(table);
    if (!cfg) continue;

    if (isVirtual(tableSql)) {
      // Existence was checked above. The rest is FTS5's internal shape.
      notes.push(`${table} is an FTS5 virtual table; column/index shape not compared`);
      continue;
    }

    // ---- columns ---------------------------------------------------------
    const dbCols = sqlColumns(db, table);
    const dbColByName = new Map(dbCols.map((c) => [c.name, c]));
    const tsColByName = new Map(cfg.columns.map((c) => [c.name, c]));

    for (const c of dbCols) {
      if (!tsColByName.has(c.name)) fail(table, `column ${c.name} missing from schema.ts`);
    }
    for (const name of tsColByName.keys()) {
      if (!dbColByName.has(name)) fail(table, `column ${name} in schema.ts is not in SQL`);
    }

    for (const [name, tsCol] of tsColByName) {
      const dbCol = dbColByName.get(name);
      if (!dbCol) continue;
      columnsChecked++;

      const sqlNotNull = dbCol.notnull === 1;
      if (sqlNotNull !== tsCol.notNull) {
        fail(
          table,
          `column ${name}: NOT NULL is ${sqlNotNull} in SQL, ${tsCol.notNull} in schema.ts`
        );
      }

      // pragma_table_xinfo: hidden 2 = VIRTUAL generated, 3 = STORED generated.
      const sqlGenerated = dbCol.hidden === 2 ? 'virtual' : dbCol.hidden === 3 ? 'stored' : null;
      const tsGenerated = tsCol.generated ? (tsCol.generated.mode ?? 'virtual') : null;
      if (sqlGenerated !== tsGenerated) {
        fail(
          table,
          `column ${name}: generated is ${sqlGenerated ?? 'no'} in SQL, ` +
            `${tsGenerated ?? 'no'} in schema.ts`
        );
      }

      const sqlPk = dbCol.pk > 0;
      const tsPk =
        tsCol.primary || cfg.primaryKeys.some((pk) => pk.columns.some((c) => c.name === name));
      if (sqlPk !== tsPk) {
        fail(table, `column ${name}: primary key is ${sqlPk} in SQL, ${tsPk} in schema.ts`);
      }

      // ---- enum parity ---------------------------------------------------
      if (tsCol.enumValues && tsCol.enumValues.length) {
        enumsChecked++;
        const fromSql = sqlEnumValues(tableSql, name);
        if (!fromSql) {
          fail(table, `column ${name}: schema.ts declares an enum but SQL has no CHECK ... IN (...)`);
        } else {
          const a = [...fromSql].sort();
          const b = [...tsCol.enumValues].sort();
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            fail(
              table,
              `column ${name}: enum drift.\n      SQL: ${JSON.stringify(a)}\n      TS : ${JSON.stringify(b)}`
            );
          }
        }
      }
    }

    // ---- indexes ---------------------------------------------------------
    const dbIdx = sqlIndexes(db, table);
    const tsIdxByName = new Map(cfg.indexes.map((i) => [i.config.name, i.config]));
    for (const idx of dbIdx) {
      indexesChecked++;
      const tsIdx = tsIdxByName.get(idx.name);
      if (!tsIdx) {
        fail(table, `index ${idx.name} exists in SQL but not in schema.ts`);
        continue;
      }
      if (!!tsIdx.unique !== idx.unique) {
        fail(table, `index ${idx.name}: UNIQUE is ${idx.unique} in SQL, ${!!tsIdx.unique} in TS`);
      }
      if (!!tsIdx.where !== idx.partial) {
        fail(
          table,
          `index ${idx.name}: partial is ${idx.partial} in SQL, ${!!tsIdx.where} in TS`
        );
      }
      // Key columns: Drizzle entries are either a Column or a raw SQL chunk
      // (used for 'col DESC'). Render both sides to lowercase text.
      const tsKeys = tsIdx.columns.map((c) => {
        if (c && typeof c === 'object' && 'name' in c && typeof c.name === 'string') {
          return c.name.toLowerCase();
        }
        return String(c?.queryChunks?.map((q) => q?.value?.join?.('') ?? '').join('') ?? c)
          .trim()
          .toLowerCase();
      });
      if (JSON.stringify(tsKeys) !== JSON.stringify(idx.keys)) {
        fail(
          table,
          `index ${idx.name}: key columns differ.\n      SQL: ${JSON.stringify(idx.keys)}\n      TS : ${JSON.stringify(tsKeys)}`
        );
      }
    }
    for (const name of tsIdxByName.keys()) {
      if (!dbIdx.some((i) => i.name === name)) {
        fail(table, `index ${name} exists in schema.ts but not in SQL`);
      }
    }

    // ---- foreign keys ----------------------------------------------------
    const dbFks = sqlForeignKeys(db, table).sort();
    const tsFks = cfg.foreignKeys
      .map((fk) => {
        const ref = fk.reference();
        const parent = getTableConfig(ref.foreignTable).name;
        return (
          `${ref.columns.map((c) => c.name).join('+')} -> ` +
          `${parent}(${ref.foreignColumns.map((c) => c.name).join('+')}) ` +
          `ON DELETE ${(fk.onDelete ?? 'no action').toUpperCase()}`
        );
      })
      .sort();
    fksChecked += dbFks.length;
    if (JSON.stringify(dbFks) !== JSON.stringify(tsFks)) {
      const onlySql = dbFks.filter((f) => !tsFks.includes(f));
      const onlyTs = tsFks.filter((f) => !dbFks.includes(f));
      for (const f of onlySql) fail(table, `foreign key only in SQL: ${f}`);
      for (const f of onlyTs) fail(table, `foreign key only in schema.ts: ${f}`);
    }

    if (verbose) {
      console.log(
        `  ${table.padEnd(26)} ${String(dbCols.length).padStart(2)} cols, ` +
          `${String(dbIdx.length).padStart(2)} idx, ${dbFks.length} fk`
      );
    }
  }

  // ---- things only the SQL has, listed so they are a decision, not a gap --
  const triggers = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`)
    .all()
    .map((r) => r.name);
  notes.push(`${triggers.length} triggers exist only in SQL (Drizzle cannot express them): ${triggers.join(', ')}`);
  const realTables = dbTables.filter((t) => !isVirtual(t.sql));
  const notStrict = realTables.filter((t) => !/\)\s*STRICT\s*$/i.test(t.sql.trim()));
  for (const t of notStrict) fail('tables', `${t.name} is not STRICT`);
  notes.push(`${realTables.length - notStrict.length}/${realTables.length} ordinary tables are STRICT`);

  return { problems, notes, columnsChecked, indexesChecked, enumsChecked, fksChecked, tables: dbTables.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--db');
  const dbPath = resolve(
    i >= 0 && argv[i + 1] ? argv[i + 1] : join(WORKER_ROOT, '.local', 'necprep.sqlite')
  );
  if (!existsSync(dbPath)) {
    console.error(`no database at ${dbPath}. Run \`npm run db:apply:local\` first.`);
    process.exit(2);
  }
  const db = new DatabaseSync(dbPath);
  const r = await verify(db, { verbose: argv.includes('--verbose') });
  db.close();

  console.log(
    `\nchecked ${r.tables} tables: ${r.columnsChecked} columns, ${r.indexesChecked} indexes, ` +
      `${r.fksChecked} foreign keys, ${r.enumsChecked} enums`
  );
  for (const note of r.notes) console.log(`  note: ${note}`);
  if (r.problems.length === 0) {
    console.log('\nschema.ts and migrations/*.sql agree.');
    process.exit(0);
  }
  console.error(`\n${r.problems.length} drift problem(s):`);
  for (const p of r.problems) console.error(`  - ${p}`);
  process.exit(1);
}
