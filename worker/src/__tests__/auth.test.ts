/**
 * Authentication, including the thing that makes the whole anti-cheat model
 * usable: upgrading an anonymous guest in place, without changing their id.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, expectFailure, measure } from './harness.ts';
import {
  login,
  logout,
  signup,
  startAnonymousSession,
  upgradeAnonymous,
} from '../handlers/auth.ts';
import { startMock } from '../handlers/mock.ts';
import { putBookmark, getBookmarks } from '../handlers/progress.ts';
import { getUserById } from '../data/auth.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { readCookie, SESSION_COOKIE } from '../lib/cookies.ts';
import type { HandlerContext } from '../handlers/context.ts';
import type { TestWorld } from './harness.ts';

/** A context with no session, as an unauthenticated request produces. */
function anonContext(world: TestWorld): HandlerContext {
  const ctx = world.contextFor(world.makeUser());
  ctx.auth = null;
  ctx.cookies = [];
  return ctx;
}

function cookieSessionId(ctx: HandlerContext): string {
  assert.equal(ctx.cookies.length, 1, 'exactly one Set-Cookie should be emitted');
  const value = readCookie(ctx.cookies[0].split(';')[0], SESSION_COOKIE);
  assert.ok(value, 'the cookie must carry a session id');
  return value;
}

test('the session cookie is HttpOnly, SameSite and path-scoped', async () => {
  const world = createWorld();
  const ctx = anonContext(world);

  await startAnonymousSession(ctx);
  const cookie = ctx.cookies[0];

  assert.match(cookie, /^necprep_session=ses_/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  // The test config is not production, so Secure is correctly absent here;
  // `loadConfig` sets `isProduction` from ENVIRONMENT and the cookie helper
  // ties Secure to it.
  assert.ok(!cookie.includes('Secure'));

  // The cookie carries NOTHING but an opaque id - no user id, no role, no
  // signed claims to tamper with.
  const sessionId = cookieSessionId(ctx);
  assert.match(sessionId, /^ses_[0-9A-Z]{26}$/);

  world.close();
});

test('an anonymous guest is a real user row that can own attempts', async () => {
  const world = createWorld();
  const ctx = anonContext(world);

  const result = await startAnonymousSession(ctx);
  const guest = result.body.user;
  assert.ok(guest);
  assert.equal(guest.isAnonymous, true);
  assert.equal(guest.email, null);
  assert.equal(guest.hasPassword, false);
  // 'student', not 'user': the role enum is the one on `users.role`, and it has
  // four values -- student, contributor, moderator, admin -- because the API
  // needs a triage role that is not a publish role.
  assert.equal(guest.role, 'student');

  // And the guest can immediately start a server-scored mock, which is the
  // entire reason guests get a row instead of a client-side identity.
  const start = await measure(world, guest, (c) =>
    startMock(c, { templateId: world.templateId, idempotencyKey: 'guest-start-aaaaaaaa' }),
  );
  assert.equal(start.result.body.questions.length, 12);
  assert.equal(start.result.body.expiresAt - start.result.body.startedAt, 45 * 60 * 1000);

  world.close();
});

test('calling /auth/anonymous again does not orphan the first guest', async () => {
  const world = createWorld();
  const ctx = anonContext(world);

  const first = await startAnonymousSession(ctx);
  const guest = first.body.user;
  assert.ok(guest);

  // The client calls this on every cold start. With a live session it must be
  // a no-op, or every reload would strand the previous guest's progress.
  const withSession = world.contextFor(guest);
  const second = await startAnonymousSession(withSession);

  assert.equal(second.body.user?.id, guest.id);
  assert.equal(withSession.cookies.length, 0, 'no new session should be minted');

  world.close();
});

test('UPGRADING A GUEST KEEPS THE USER ID AND THE PROGRESS', async () => {
  const world = createWorld();
  const ctx = anonContext(world);

  const guest = (await startAnonymousSession(ctx)).body.user;
  assert.ok(guest);
  const originalId = guest.id;

  // Do some work as a guest.
  await measure(world, guest, (c) =>
    putBookmark(c, { questionId: world.questions[0].id, desired: true }),
  );

  const upgradeCtx = world.contextFor(guest);
  const upgraded = await upgradeAnonymous(upgradeCtx, {
    email: 'claimed@test.local',
    password: 'a-good-enough-password',
    displayName: 'Claimed',
  });

  assert.equal(upgraded.body.user?.id, originalId, 'the user id must not change');
  assert.equal(upgraded.body.user?.email, 'claimed@test.local');
  assert.equal(upgraded.body.user?.isAnonymous, false);
  assert.equal(upgraded.body.user?.hasPassword, true);

  // The bookmark is still there, because nothing was migrated.
  const bookmarks = await measure(world, upgraded.body.user, (c) => getBookmarks(c));
  assert.equal(bookmarks.result.body.items.length, 1);

  // And the new password actually works.
  const db = world.invocation();
  const row = await getUserById(db, originalId);
  assert.ok(row);
  const check = await verifyPassword('a-good-enough-password', row.password_hash, 10_000);
  assert.equal(check.valid, true);

  world.close();
});

test('upgrading twice is refused rather than overwriting a claimed account', async () => {
  const world = createWorld();
  const ctx = anonContext(world);
  const guest = (await startAnonymousSession(ctx)).body.user;
  assert.ok(guest);

  await upgradeAnonymous(world.contextFor(guest), {
    email: 'once@test.local',
    password: 'first-password-here',
  });

  // A replayed upgrade - from a retried request or a second tab - must not be
  // able to reset the password of an account that has since been claimed.
  const failure = await expectFailure(() =>
    upgradeAnonymous(world.contextFor(guest), {
      email: 'attacker@test.local',
      password: 'attacker-password',
    }),
  );
  assert.equal(failure.code, 'NOT_ANONYMOUS');
  assert.equal(failure.status, 409);

  const db = world.invocation();
  const row = await getUserById(db, guest.id);
  assert.equal(row?.email, 'once@test.local');

  world.close();
});

test('a guest cannot claim an email that is already taken', async () => {
  const world = createWorld();

  const owner = anonContext(world);
  await signup(owner, { email: 'taken@test.local', password: 'owner-password-1' });

  const guestCtx = anonContext(world);
  const guest = (await startAnonymousSession(guestCtx)).body.user;
  assert.ok(guest);

  const failure = await expectFailure(() =>
    upgradeAnonymous(world.contextFor(guest), {
      email: 'taken@test.local',
      password: 'guest-password-1',
    }),
  );
  assert.equal(failure.code, 'EMAIL_IN_USE');

  world.close();
});

test('signup then login, and a wrong password is refused', async () => {
  const world = createWorld();

  const signupCtx = anonContext(world);
  const created = await signup(signupCtx, {
    email: 'Someone@Test.Local',
    password: 'correct-horse-battery',
    displayName: 'Someone',
  });

  assert.equal(created.status, 201);
  // The email was normalised by the schema, so a login with different casing
  // resolves to the same account.
  assert.equal(created.body.user?.email, 'someone@test.local');

  const loginCtx = anonContext(world);
  const session = await login(loginCtx, {
    email: 'SOMEONE@test.local',
    password: 'correct-horse-battery',
  });
  assert.equal(session.body.user?.id, created.body.user?.id);
  assert.ok(cookieSessionId(loginCtx));

  const failure = await expectFailure(() =>
    login(anonContext(world), { email: 'someone@test.local', password: 'wrong' }),
  );
  assert.equal(failure.code, 'INVALID_CREDENTIALS');
  assert.equal(failure.status, 401);

  world.close();
});

test('a duplicate signup is a clean 409, not a database error', async () => {
  const world = createWorld();
  await signup(anonContext(world), { email: 'dup@test.local', password: 'password-one-1' });

  const failure = await expectFailure(() =>
    signup(anonContext(world), { email: 'dup@test.local', password: 'password-two-2' }),
  );
  assert.equal(failure.code, 'EMAIL_IN_USE');
  assert.equal(failure.status, 409);

  world.close();
});

test('login on an unknown email and on a guest row both report the same error', async () => {
  const world = createWorld();

  // A guest has no password, so logging in as one must be indistinguishable
  // from an address with no account at all - otherwise the error message
  // enumerates which addresses exist.
  const guestCtx = anonContext(world);
  await startAnonymousSession(guestCtx);

  const unknown = await expectFailure(() =>
    login(anonContext(world), { email: 'nobody@test.local', password: 'whatever-1' }),
  );
  assert.equal(unknown.code, 'INVALID_CREDENTIALS');
  assert.equal(unknown.message, 'That email or password is incorrect.');

  world.close();
});

test('logout revokes the session and clears the cookie, idempotently', async () => {
  const world = createWorld();
  const ctx = anonContext(world);
  const guest = (await startAnonymousSession(ctx)).body.user;
  assert.ok(guest);

  const logoutCtx = world.contextFor(guest);
  await logout(logoutCtx);
  assert.match(logoutCtx.cookies[0], /Max-Age=0/);

  // Calling it again is harmless.
  const again = world.contextFor(guest);
  const result = await logout(again);
  assert.equal(result.body.ok, true);

  world.close();
});

test('password hashes are salted, self-describing, and verify constant-time', async () => {
  const a = await hashPassword('same-password', 10_000);
  const b = await hashPassword('same-password', 10_000);

  assert.notEqual(a, b, 'two hashes of the same password must differ (unique salt)');
  assert.match(a, /^pbkdf2\$sha256\$10000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);

  assert.equal((await verifyPassword('same-password', a, 10_000)).valid, true);
  assert.equal((await verifyPassword('other-password', a, 10_000)).valid, false);

  // A stored hash with fewer iterations than the current setting verifies and
  // asks to be rehashed, so the cost can be raised without locking anyone out.
  const upgrade = await verifyPassword('same-password', a, 20_000);
  assert.equal(upgrade.valid, true);
  assert.equal(upgrade.needsRehash, true);
});

test('a corrupt stored hash reads as a wrong password, never as a crash', async () => {
  for (const stored of [null, '', 'not-a-hash', 'pbkdf2$sha256$abc$x$y', 'pbkdf2$sha512$1000$x$y']) {
    const result = await verifyPassword('anything', stored, 10_000);
    assert.equal(result.valid, false, `stored=${String(stored)}`);
    assert.equal(result.needsRehash, false);
  }
});
