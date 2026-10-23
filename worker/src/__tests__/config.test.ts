/**
 * `loadConfig`, and specifically the blast radius of a misconfiguration.
 *
 * This runs in the `/api/*` middleware, once per request, before any handler.
 * So anything it throws for takes down EVERY endpoint — and the cases where
 * that is right are narrow.
 *
 * It was not narrow enough. A half-configured Google OAuth app threw, which
 * meant one missing secret 500'd the chapter list, guest sign-in and paper
 * submission, each reporting "Google OAuth needs GOOGLE_CLIENT_ID..." — a
 * baffling thing to read when you asked for a list of chapters. Found by
 * running `wrangler dev` against a `.dev.vars` with one of the three filled in.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../env.ts';
import type { Env } from '../env.ts';

const SECRET = 'test-permutation-secret-0123456789abcdef';

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: null as unknown as Env['DB'],
    APP_ORIGIN: 'https://app.test',
    CONTENT_PERMUTATION_SECRET: SECRET,
    ...overrides,
  } as Env;
}

const GOOGLE = {
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REDIRECT_URI: 'https://api.test/api/auth/google/callback',
};

// --- What must still fail hard -----------------------------------------------

test('a missing APP_ORIGIN fails closed', () => {
  // This one genuinely affects every request: it is the CORS policy.
  assert.throws(() => loadConfig(env({ APP_ORIGIN: undefined })), /not configured/i);
  assert.throws(() => loadConfig(env({ APP_ORIGIN: '   ' })), /not configured/i);
});

test('a missing or short CONTENT_PERMUTATION_SECRET fails closed', () => {
  assert.throws(() => loadConfig(env({ CONTENT_PERMUTATION_SECRET: undefined })), /not configured/i);
  // Short enough to be reproduced offline against the public chapter JSON.
  assert.throws(() => loadConfig(env({ CONTENT_PERMUTATION_SECRET: 'too-short' })), /not configured/i);
});

test('an out-of-range numeric setting fails closed rather than clamping', () => {
  assert.throws(() => loadConfig(env({ D1_QUERY_BUDGET: '9999' })), /not configured/i);
  assert.throws(() => loadConfig(env({ PASSWORD_HASH_ITERATIONS: 'lots' })), /not configured/i);
});

// --- What must NOT take the platform down ------------------------------------

test('no Google configuration at all is a normal, working deployment', () => {
  const config = loadConfig(env());
  assert.equal(config.google, null);
  assert.equal(config.googleConfigError, null);
});

test('a HALF-configured Google app does not throw', () => {
  // The regression. An optional feature must not be able to break a required
  // one; `requireGoogle` reports it on the Google routes instead.
  for (const partial of [
    { GOOGLE_CLIENT_ID: GOOGLE.GOOGLE_CLIENT_ID },
    { GOOGLE_REDIRECT_URI: GOOGLE.GOOGLE_REDIRECT_URI },
    { GOOGLE_CLIENT_ID: GOOGLE.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: GOOGLE.GOOGLE_CLIENT_SECRET },
  ]) {
    const config = loadConfig(env(partial));
    assert.equal(config.google, null, JSON.stringify(partial));
    assert.match(config.googleConfigError ?? '', /GOOGLE_CLIENT_ID/);
    // And the rest of the config is intact, so every other endpoint works.
    assert.equal(config.appOrigin, 'https://app.test');
    assert.equal(config.permutationSecret, SECRET);
  }
});

test('an empty-string Google value counts as unset, not as set', () => {
  // `.dev.vars` and `wrangler secret` both make it easy to end up with an
  // empty value rather than an absent one.
  const config = loadConfig(env({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '   ' }));
  assert.equal(config.google, null);
  assert.equal(config.googleConfigError, null);
});

test('all three set gives a usable Google config', () => {
  const config = loadConfig(env(GOOGLE));
  assert.equal(config.googleConfigError, null);
  assert.ok(config.google);
  assert.equal(config.google.clientId, GOOGLE.GOOGLE_CLIENT_ID);
  assert.equal(config.google.redirectUri, GOOGLE.GOOGLE_REDIRECT_URI);
});

test('surrounding whitespace is trimmed off the Google values', () => {
  // A redirect URI with a trailing newline, pasted from a terminal, is the
  // classic cause of redirect_uri_mismatch — which Google reports at its end,
  // far from the cause.
  const config = loadConfig(
    env({
      GOOGLE_CLIENT_ID: `  ${GOOGLE.GOOGLE_CLIENT_ID}  `,
      GOOGLE_CLIENT_SECRET: GOOGLE.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: `${GOOGLE.GOOGLE_REDIRECT_URI}\n`,
    }),
  );
  assert.ok(config.google);
  assert.equal(config.google.clientId, GOOGLE.GOOGLE_CLIENT_ID);
  assert.equal(config.google.redirectUri, GOOGLE.GOOGLE_REDIRECT_URI);
});
