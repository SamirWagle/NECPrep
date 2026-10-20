#!/usr/bin/env node
/**
 * bundle-budget.mjs
 *
 * Fails the build when initial-load JavaScript grows past its budget.
 *
 * Why a hard gate rather than a dashboard: most of this app's audience sits on
 * entry-level Android handsets on 3G in Nepal. On a 400 kbit/s effective link,
 * every 50 kB of gzipped JavaScript is roughly another second before anything is
 * interactive - and that is before the phone has to parse and compile it. A
 * budget that nothing enforces is a number in a README; this one blocks the PR.
 *
 * What counts as "initial-load": exactly the JavaScript the browser fetches
 * before it can render the landing page. Vite declares that set in dist/index.html
 * as the entry <script type="module"> plus one <link rel="modulepreload"> per
 * static import of that entry. Route chunks behind React.lazy() are NOT listed
 * there and are NOT counted - they are the reason the budget is affordable, and
 * counting them would punish code splitting.
 *
 * Sizes are gzipped, because that is what crosses the wire. 1 kB = 1000 bytes,
 * matching Vite's own build report so the two sets of numbers can be compared.
 *
 * Usage:
 *   node .github/scripts/bundle-budget.mjs
 *   node .github/scripts/bundle-budget.mjs --dist frontend/dist --budget 180
 *   node .github/scripts/bundle-budget.mjs --json
 *
 * Exit codes: 0 within budget, 1 over budget, 2 could not run.
 */

import { readFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const DIST = resolve(REPO_ROOT, flag('dist', 'frontend/dist'));
/** Budget in kB (1000 bytes) of gzipped initial-load JavaScript. */
const BUDGET_KB = Number(flag('budget', '180'));
const BUDGET_BYTES = BUDGET_KB * 1000;
const asJson = args.includes('--json');

if (!Number.isFinite(BUDGET_KB) || BUDGET_KB <= 0) {
  console.error(`Invalid --budget: ${flag('budget', '180')}`);
  process.exit(2);
}

const INDEX = join(DIST, 'index.html');
if (!existsSync(INDEX)) {
  console.error(
    `No build to measure: ${INDEX} does not exist.\n` +
      `Run the production build first (cd frontend && npm run build).`
  );
  process.exit(2);
}

const html = readFileSync(INDEX, 'utf8');

/**
 * Pull every local asset reference out of index.html.
 *
 * Only same-origin references are measured. A third-party <script src="https://...">
 * (this page loads AdSense) is real cost to the user but is not shipped from this
 * repo, cannot be fixed by a diff here, and would make the number depend on a
 * vendor we do not control.
 */
const isLocal = (url) => !!url && !/^(https?:)?\/\//.test(url) && !url.startsWith('data:');
const unique = (xs) => [...new Set(xs)];

const collect = (re, group) =>
  unique([...html.matchAll(re)].map((m) => m[group]).filter(isLocal));

// Entry module(s): <script type="module" src="/assets/index-xxxx.js">
const entryScripts = collect(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, 1);
// Static imports of the entry, hoisted by Vite: <link rel="modulepreload" href="...">
const preloadedModules = collect(
  /<link\b[^>]*\brel=["'](?:modulepreload|preload)["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
  1
);
// Render-blocking stylesheets. Not part of the JS budget, but reported, since
// they block first paint and are easy to forget.
const stylesheets = collect(
  /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
  1
);

const sizeOf = (url) => {
  const file = join(DIST, url.replace(/^\//, '').split('?')[0]);
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  const buf = readFileSync(file);
  // Default zlib level, to match Vite's own gzip column.
  return { url, raw: buf.length, gzip: gzipSync(buf).length };
};

const measure = (urls, kind) =>
  urls
    .map((u) => {
      const s = sizeOf(u);
      if (!s) {
        console.error(`::warning::Referenced in index.html but missing from the build: ${u}`);
        return null;
      }
      return { ...s, kind };
    })
    .filter(Boolean);

const js = [
  ...measure(entryScripts, 'entry'),
  ...measure(preloadedModules, 'static-import'),
].filter((a) => /\.m?js$/.test(a.url));

const css = measure(stylesheets, 'stylesheet');

if (js.length === 0) {
  console.error(
    `Found no initial-load JavaScript in ${INDEX}. ` +
      `Either the build is broken or the markup no longer matches what this script parses.`
  );
  process.exit(2);
}

const sum = (xs, k) => xs.reduce((n, x) => n + x[k], 0);
const totalGzip = sum(js, 'gzip');
const totalRaw = sum(js, 'raw');
const cssGzip = sum(css, 'gzip');
const over = totalGzip > BUDGET_BYTES;

const kb = (n) => (n / 1000).toFixed(2);
const pct = ((totalGzip / BUDGET_BYTES) * 100).toFixed(1);

const report = {
  budgetKb: BUDGET_KB,
  initialJs: { rawBytes: totalRaw, gzipBytes: totalGzip, chunks: js },
  blockingCss: { gzipBytes: cssGzip, files: css },
  usedPercent: Number(pct),
  withinBudget: !over,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const rows = [...js].sort((a, b) => b.gzip - a.gzip);
  const name = (u) => u.replace(/^.*\//, '');
  const width = Math.max(12, ...rows.map((r) => name(r.url).length));

  console.log(`\n  Initial-load JavaScript budget\n`);
  console.log(`  ${'chunk'.padEnd(width)} ${'raw kB'.padStart(9)} ${'gzip kB'.padStart(9)}`);
  for (const r of rows) {
    console.log(`  ${name(r.url).padEnd(width)} ${kb(r.raw).padStart(9)} ${kb(r.gzip).padStart(9)}`);
  }
  console.log(`  ${'-'.repeat(width + 20)}`);
  console.log(
    `  ${`TOTAL (${rows.length} chunks)`.padEnd(width)} ${kb(totalRaw).padStart(9)} ${kb(totalGzip).padStart(9)}`
  );
  if (css.length) {
    console.log(
      `\n  Render-blocking CSS (not in the JS budget): ${kb(cssGzip)} kB gzip ` +
        `across ${css.length} file(s)`
    );
  }
  console.log(
    `\n  ${kb(totalGzip)} kB of ${BUDGET_KB} kB used (${pct}%). ` +
      `${over ? 'OVER BUDGET' : `${kb(BUDGET_BYTES - totalGzip)} kB of headroom`}.\n`
  );
}

// GitHub Actions surfaces: a job-summary table and, on failure, an annotation.
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### Initial-load JS budget: ${over ? 'FAIL' : 'pass'}`,
    '',
    `**${kb(totalGzip)} kB** gzipped of a **${BUDGET_KB} kB** budget (${pct}% used).`,
    '',
    '| chunk | raw kB | gzip kB |',
    '| --- | --: | --: |',
    ...[...js]
      .sort((a, b) => b.gzip - a.gzip)
      .map((r) => `| \`${r.url.replace(/^.*\//, '')}\` | ${kb(r.raw)} | ${kb(r.gzip)} |`),
    `| **total** | **${kb(totalRaw)}** | **${kb(totalGzip)}** |`,
    '',
    `Render-blocking CSS, outside this budget: ${kb(cssGzip)} kB gzip.`,
    '',
    'Route chunks loaded behind `React.lazy()` are excluded: they are not fetched',
    'before first render. Keep them that way.',
    '',
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

if (over) {
  console.error(
    `::error::Initial-load JavaScript is ${kb(totalGzip)} kB gzipped, over the ` +
      `${BUDGET_KB} kB budget by ${kb(totalGzip - BUDGET_BYTES)} kB. ` +
      `Lazy-load it behind a route, drop the dependency, or raise the budget deliberately ` +
      `in .github/workflows/ci.yml with a reason.`
  );
  process.exit(1);
}
