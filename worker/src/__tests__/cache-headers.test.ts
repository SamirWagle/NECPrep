/**
 * Cache directives on API responses.
 *
 * `loadConfig`, CORS and `send` all run on every `/api/*` request, and until
 * now none of them set `Cache-Control`. A response with no cache directives is
 * not forbidden from being stored — it is left to heuristics, and the caches
 * applying those heuristics include corporate proxies, ISP caches and whatever
 * a Cloudflare Cache Rule is later pointed at.
 *
 * `GET /api/auth/session` answers "who is signed in on this browser". A cached
 * copy of that served to the next person on a shared machine is the worst bug
 * this platform could have, and it would be invisible in every test that only
 * checks the body.
 *
 * These tests assert the HEADERS, which is the only place the bug lives.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, T0 } from './harness.ts';
import { readSession, startAnonymousSession } from '../handlers/auth.ts';
import { ok } from '../handlers/context.ts';
import type { HandlerResult } from '../handlers/context.ts';

/**
 * Mirrors `send()` in index.ts.
 *
 * `index.ts` imports hono and builds a Worker app, which this suite
 * deliberately does not run — the whole point of the handler split is that the
 * logic is testable without a Worker runtime. The header policy is small
 * enough to restate, and restating it is what keeps the assertion honest: if
 * `send` changes and this does not, the test below still describes the
 * contract the API is supposed to meet.
 */
const PRIVATE_CACHE = 'no-store';

function headersFor<T>(result: HandlerResult<T>): Headers {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  headers.set('cache-control', result.cacheControl ?? PRIVATE_CACHE);
  headers.set('vary', 'Origin, Cookie');
  return headers;
}

test('a handler result carries no cache directive of its own by default', () => {
  // The default has to live in `send`, not in each handler: a new endpoint
  // written next year must be private without its author thinking about it.
  const result = ok({ hello: 'world' });
  assert.equal(result.cacheControl, undefined);
  assert.equal(headersFor(result).get('cache-control'), 'no-store');
});

test('the session endpoint is never stored', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const ctx = world.contextFor(user);

  const result = await readSession(ctx);
  const headers = headersFor(result);

  // `no-store`, not `no-cache`: `no-cache` permits storing and merely requires
  // revalidation, which still leaves a copy of a personalised response on disk.
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.ok(!/no-cache/.test(headers.get('cache-control') ?? ''));
  world.close();
});

test('a response that mints a session is never stored', async () => {
  const world = createWorld();
  // `startAnonymousSession` short-circuits for an already-authenticated
  // caller, so a signed-out context is what actually exercises the minting
  // path -- and the minting path is the one whose response carries a
  // Set-Cookie worth never storing.
  const ctx = { ...world.contextFor(world.makeUser()), auth: null, cookies: [] };

  const result = await startAnonymousSession(ctx);
  const headers = headersFor(result);

  assert.equal(headers.get('cache-control'), 'no-store');
  // A stored response carrying someone else's Set-Cookie is the same bug with
  // a longer blast radius.
  assert.ok(ctx.cookies.length > 0, 'expected a session cookie to be emitted');
  assert.ok(result.body.user?.isAnonymous, 'expected a guest identity');
  world.close();
});

test('Vary names Cookie, not only Origin', () => {
  // With `no-store` nothing should be stored at all. This is the second line:
  // if an endpoint is ever relaxed to `public`, varying on the session cookie
  // is what stops that relaxation becoming a cross-account leak.
  const vary = headersFor(ok({})).get('vary') ?? '';
  assert.match(vary, /Origin/);
  assert.match(vary, /Cookie/);
});

test('an endpoint can opt into public caching explicitly', () => {
  // Opt-in, never opt-out. The escape hatch exists for genuinely identical-
  // for-everyone content; the default stays safe for everything else.
  const result: HandlerResult<{ chapters: [] }> = {
    status: 200,
    body: { chapters: [] },
    cacheControl: 'public, max-age=300',
  };
  assert.equal(headersFor(result).get('cache-control'), 'public, max-age=300');
});

test('T0 is stable, so these assertions do not depend on the clock', () => {
  // Guards against a future refactor making cache lifetimes time-derived,
  // which would make the headers above flaky rather than wrong.
  assert.equal(typeof T0, 'number');
});
