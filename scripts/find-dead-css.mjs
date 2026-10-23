/**
 * Find — and optionally remove — CSS rules that can never match.
 *
 *   node scripts/find-dead-css.mjs            # report
 *   node scripts/find-dead-css.mjs --write    # rewrite the file
 *   node scripts/find-dead-css.mjs --list     # also print every dead name
 *
 * WHY THIS EXISTS
 * ---------------
 * `frontend/src/App.css` predates the design system and the CSS-module layout,
 * and it accumulated the styling of several features that were later removed —
 * the Supabase sign-in UI abandoned in ADR 0001, and the paginated mock-test
 * layout dropped when the quiz engine landed. The first pass removed 214 rules
 * and 1,062 lines. The file is still large, so this is a tool rather than a
 * one-off: the rest of the migration will keep orphaning rules, and nobody
 * should have to re-derive which ones.
 *
 * THE TEST IT APPLIES
 * -------------------
 * A selector that contains a class name appearing NOWHERE in the sources
 * cannot match any element, so its rule is dead. Compound selectors count:
 * `.login-page .btn-primary` is dead even though `.btn-primary` is live,
 * because no element ever carries `.login-page`.
 *
 * WHY IT IS SAFE TO BELIEVE
 * -------------------------
 * Every step is biased toward keeping a rule:
 *
 *   * "Used" means the class name appears anywhere in any `.tsx`, `.ts` or
 *     other `.css` file, or in `index.html` — including inside a comment or a
 *     test. One mention anywhere and the rule survives.
 *   * Class names COMPOSED at runtime are detected and excluded. The script
 *     scans template literals for `prefix-${...}` and treats everything under
 *     such a prefix as live, because `panel-${tone}` can produce a name that
 *     exists nowhere as a literal.
 *   * A rule whose selector list mixes dead and live selectors keeps the live
 *     ones; only fully-dead rules are dropped.
 *   * Only CLASS selectors are examined. Element, id, attribute and pseudo
 *     selectors are never a reason to remove anything.
 *
 * What it cannot see: a class injected by a third-party script, or built by
 * string concatenation rather than a template literal (`'btn-' + kind`). Both
 * are absent from this codebase today; if either arrives, this tool needs to
 * learn about it before being trusted again.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(ROOT, 'frontend');
const TARGET = join(FRONTEND, 'src', 'App.css');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const LIST = args.includes('--list');

/** Every class name in a chunk of CSS or a selector. */
const CLASS_RE = /\.(-?[A-Za-z_][\w-]*)/g;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...(await walk(path)));
    } else {
      out.push(path);
    }
  }
  return out;
}

/**
 * Everything a class name could legitimately be mentioned in.
 *
 * Tests are INCLUDED on purpose: a class asserted by a test is a class the app
 * is expected to render, and removing its rule would make the test pass while
 * the page looked wrong.
 */
async function readSources() {
  const files = await walk(join(FRONTEND, 'src'));
  const parts = [];
  for (const path of files) {
    if (path === TARGET) continue;
    if (/\.(tsx|ts|css)$/.test(path)) {
      parts.push(await readFile(path, 'utf8'));
    }
  }
  const html = join(FRONTEND, 'index.html');
  if (existsSync(html)) parts.push(await readFile(html, 'utf8'));
  return parts.join('\n');
}

/** Class prefixes actually composed as `foo-${x}` inside a template literal. */
function dynamicPrefixes(source) {
  const found = new Set();
  for (const [, literal] of source.matchAll(/`([^`]*)`/gs)) {
    for (const [, prefix] of literal.matchAll(/([A-Za-z][\w-]*-)\$\{/g)) {
      found.add(prefix);
    }
  }
  return [...found].sort();
}

/* ------------------------------------------------------------------ *
 * A deliberately small CSS splitter.
 *
 * App.css is plain CSS: rules and at-blocks, no nesting. Brace matching is
 * enough, and a real parser would be a dependency for one file.
 * ------------------------------------------------------------------ */

function splitBlocks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out.push({ kind: 'raw', text: text.slice(i, stop) });
      i = stop;
      continue;
    }
    if (/\s/.test(text[i])) {
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      out.push({ kind: 'raw', text: text.slice(i, j) });
      i = j;
      continue;
    }
    const brace = text.indexOf('{', i);
    if (brace === -1) {
      out.push({ kind: 'raw', text: text.slice(i) });
      break;
    }
    const prelude = text.slice(i, brace);
    let depth = 1;
    let j = brace + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth += 1;
      else if (text[j] === '}') depth -= 1;
      j += 1;
    }
    out.push({
      kind: prelude.trimStart().startsWith('@') ? 'at' : 'rule',
      prelude,
      body: text.slice(brace + 1, j - 1),
    });
    i = j;
  }
  return out;
}

const css = await readFile(TARGET, 'utf8');
const sources = await readSources();
const DYNAMIC = dynamicPrefixes(sources);

const allNames = new Set([...css.matchAll(CLASS_RE)].map((m) => m[1]));
const dead = new Set(
  [...allNames].filter(
    (name) => !sources.includes(name) && !DYNAMIC.some((p) => name.startsWith(p)),
  ),
);

function selectorIsDead(selector) {
  return [...selector.matchAll(CLASS_RE)].some((m) => dead.has(m[1]));
}

const stats = { rulesRemoved: 0, selectorsDropped: 0, atBlocksEmptied: 0 };

/** Nestable at-rules, i.e. the ones whose bodies contain rules. */
const NESTED_AT = ['@media', '@supports', '@layer', '@container'];

function prune(text) {
  const pieces = [];
  for (const block of splitBlocks(text)) {
    if (block.kind === 'raw') {
      pieces.push(block.text);
      continue;
    }
    if (block.kind === 'at') {
      const at = block.prelude.trimStart();
      if (NESTED_AT.some((k) => at.startsWith(k))) {
        const inner = prune(block.body);
        // An at-block whose every rule died has nothing left to say.
        if (inner.trim() === '') {
          stats.atBlocksEmptied += 1;
          continue;
        }
        pieces.push(`${block.prelude}{${inner}}`);
      } else {
        // @keyframes, @font-face, @import: left exactly as found.
        pieces.push(`${block.prelude}{${block.body}}`);
      }
      continue;
    }

    const selectors = block.prelude.split(',');
    const kept = selectors.filter((s) => !selectorIsDead(s));
    if (kept.length === selectors.length) {
      pieces.push(`${block.prelude}{${block.body}}`);
      continue;
    }
    stats.selectorsDropped += selectors.length - kept.length;
    if (kept.length === 0) {
      stats.rulesRemoved += 1;
      continue;
    }
    pieces.push(`${kept.join(',')}{${block.body}}`);
  }
  return pieces.join('');
}

const result = prune(css);
const before = css.split('\n').length;
const after = result.split('\n').length;

console.log(`target                 ${TARGET.replace(ROOT + '/', '')}`);
console.log(`dynamic prefixes kept  ${DYNAMIC.length ? DYNAMIC.join(', ') : '(none found)'}`);
console.log(`class names in file    ${allNames.size}`);
console.log(`dead class names       ${dead.size}`);
console.log(`rules removed          ${stats.rulesRemoved}`);
console.log(`at-blocks emptied      ${stats.atBlocksEmptied}`);
console.log(`selectors dropped      ${stats.selectorsDropped} (from rules that survive)`);
console.log(`lines                  ${before} -> ${after} (${before - after} removed)`);

if (LIST && dead.size > 0) {
  console.log('\ndead class names:');
  for (const name of [...dead].sort()) console.log(`  .${name}`);
}

if (WRITE) {
  await writeFile(TARGET, result, 'utf8');
  console.log('\nwritten. Re-run the frontend suite and the build before committing.');
} else if (dead.size > 0) {
  console.log('\n(report only; pass --write to apply)');
}
