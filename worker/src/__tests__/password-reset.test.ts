/**
 * Password reset.
 *
 * A reset link is a bearer credential that arrives over email, sits in an
 * inbox, and is routinely forwarded or synced to other devices. It is the
 * weakest link in most authentication systems, so almost everything below is
 * about what the flow REFUSES to do.
 *
 * The one that is not about refusal is the first: before this existed, a
 * forgotten password meant a permanently lost account — every attempt,
 * bookmark and streak with it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, T0 } from './harness.ts';
import type { TestWorld } from './harness.ts';
import { login, requestPasswordReset, resetPassword, signup } from '../handlers/auth.ts';
import { expectFailure } from './harness.ts';
import { RESET_TOKEN_TTL_MS } from '../data/auth.ts';
import type { EmailMessage, EmailSender } from '../lib/email.ts';
import { MINUTE } from '../lib/time.ts';

const EMAIL = 'student@example.test';
const OLD_PASSWORD = 'the-old-password';
const NEW_PASSWORD = 'a-brand-new-password';

/** Captures what would have been sent, so no test reaches the network. */
function recordingSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    name: 'test',
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

function signedOut(world: TestWorld) {
  return { ...world.contextFor(world.makeUser()), auth: null, cookies: [] };
}

/** Creates a real account and returns a signed-out context to act against it. */
async function withAccount(world: TestWorld) {
  const ctx = signedOut(world);
  await signup(ctx, { email: EMAIL, password: OLD_PASSWORD });
  return ctx;
}

/** Pulls the token out of the emailed link, the way a student's browser would. */
function tokenFrom(message: EmailMessage): string {
  const match = /[?&]token=([^\s&]+)/.exec(message.text);
  assert.ok(match, 'the email should carry a reset link');
  return decodeURIComponent(match[1]);
}

// --- The capability ----------------------------------------------------------

test('a forgotten password can be reset, and signs the student back in', async () => {
  const world = createWorld();
  await withAccount(world);
  const sender = recordingSender();

  const request = signedOut(world);
  await requestPasswordReset(request, { email: EMAIL }, sender);
  assert.equal(sender.sent.length, 1);

  const redeem = signedOut(world);
  const result = await resetPassword(redeem, {
    token: tokenFrom(sender.sent[0]),
    password: NEW_PASSWORD,
  });

  assert.equal(result.body.user?.email, EMAIL);
  // A reset that left them on the sign-in page would be a worse experience
  // than the problem it solved.
  assert.ok(redeem.cookies.length > 0, 'expected a session cookie');

  // And the new password actually works.
  const after = signedOut(world);
  const signedIn = await login(after, { email: EMAIL, password: NEW_PASSWORD });
  assert.equal(signedIn.body.user?.email, EMAIL);
  world.close();
});

test('the old password stops working', async () => {
  const world = createWorld();
  await withAccount(world);
  const sender = recordingSender();
  await requestPasswordReset(signedOut(world), { email: EMAIL }, sender);
  await resetPassword(signedOut(world), {
    token: tokenFrom(sender.sent[0]),
    password: NEW_PASSWORD,
  });

  const failure = await expectFailure(() =>
    login(signedOut(world), { email: EMAIL, password: OLD_PASSWORD }),
  );
  assert.equal(failure.code, 'INVALID_CREDENTIALS');
  world.close();
});

// --- What it refuses ---------------------------------------------------------

test('the response is identical for an address that does not exist', async () => {
  const world = createWorld();
  await withAccount(world);
  const sender = recordingSender();

  const known = await requestPasswordReset(signedOut(world), { email: EMAIL }, sender);
  const unknown = await requestPasswordReset(
    signedOut(world),
    { email: 'nobody@example.test' },
    sender,
  );

  // An endpoint that says "no such account" is an address checker: point a
  // list at it and it returns everyone who has signed up, which for an exam
  // platform is a list of named candidates.
  assert.deepEqual(known.body, unknown.body);
  assert.equal(known.status, unknown.status);
  // And only the real one actually produced a message.
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.sent[0].to, EMAIL);
  world.close();
});

test('a token cannot be used twice', async () => {
  const world = createWorld();
  await withAccount(world);
  const sender = recordingSender();
  await requestPasswordReset(signedOut(world), { email: EMAIL }, sender);
  const token = tokenFrom(sender.sent[0]);

  await resetPassword(signedOut(world), { token, password: NEW_PASSWORD });

  // This is how a forwarded email becomes an account takeover a week later.
  const failure = await expectFailure(() =>
    resetPassword(signedOut(world), { token, password: 'another-password-again' }),
  );
  assert.equal(failure.code, 'INVALID_CREDENTIALS');
  world.close();
});

test('a token expires', async () => {
  const world = createWorld();
  await withAccount(world);
  const sender = recordingSender();
  await requestPasswordReset(signedOut(world), { email: EMAIL }, sender);
  const token = tokenFrom(sender.sent[0]);

  world.clock.advance(RESET_TOKEN_TTL_MS + MINUTE);

  const failure = await expectFailure(() =>
    resetPassword(signedOut(world), { token, password: NEW_PASSWORD }),
  );
  assert.equal(failure.code, 'INVALID_CREDENTIALS');
  world.close();
});

test('requesting again retires the previous link', async () => {
  const world = createWorld();
  await withAccount(world);
  const sender = recordingSender();

  await requestPasswordReset(signedOut(world), { email: EMAIL }, sender);
  const first = tokenFrom(sender.sent[0]);
  await requestPasswordReset(signedOut(world), { email: EMAIL }, sender);
  const second = tokenFrom(sender.sent[1]);
  assert.notEqual(first, second);

  // Clicking "forgot password" five times should leave one usable link, not
  // five live keys sitting in an inbox.
  const failure = await expectFailure(() =>
    resetPassword(signedOut(world), { token: first, password: NEW_PASSWORD }),
  );
  assert.equal(failure.code, 'INVALID_CREDENTIALS');

  const okResult = await resetPassword(signedOut(world), {
    token: second,
    password: NEW_PASSWORD,
  });
  assert.equal(okResult.body.user?.email, EMAIL);
  world.close();
});

test('the token is never stored in the clear', async () => {
  const world = createWorld();
  await withAccount(world);
  const sender = recordingSender();
  await requestPasswordReset(signedOut(world), { email: EMAIL }, sender);
  const token = tokenFrom(sender.sent[0]);

  const row = world.d1.raw
    .prepare('SELECT id FROM password_reset_tokens WHERE consumed_at IS NULL')
    .get() as { id: string };

  // Same discipline as sessions: a dump of this table yields nothing anyone
  // can redeem.
  assert.notEqual(row.id, token);
  assert.match(row.id, /^[0-9a-f]{64}$/);
  world.close();
});

test('resetting revokes every existing session', async () => {
  const world = createWorld();
  const signupCtx = await withAccount(world);
  // Signing up established a session; log in again elsewhere for a second.
  await login(signedOut(world), { email: EMAIL, password: OLD_PASSWORD });

  const live = () =>
    (
      world.d1.raw
        .prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL')
        .get() as { n: number }
    ).n;
  assert.ok(live() >= 1, 'expected at least one live session');
  assert.ok(signupCtx.cookies.length > 0);

  const sender = recordingSender();
  await requestPasswordReset(signedOut(world), { email: EMAIL }, sender);
  await resetPassword(signedOut(world), {
    token: tokenFrom(sender.sent[0]),
    password: NEW_PASSWORD,
  });

  // Resetting a password is what someone does when they believe an account is
  // compromised. Leaving the attacker's session live would make it theatre.
  // Exactly one survives: the brand-new one on the device that just reset.
  assert.equal(live(), 1);
  world.close();
});

test('a Google-only account cannot have a password attached by email', async () => {
  const world = createWorld();
  const sender = recordingSender();

  // No local account at all: the address is unknown to the password path.
  const result = await requestPasswordReset(
    signedOut(world),
    { email: 'google-only@example.test' },
    sender,
  );

  // Sending here would let an intercepted message attach a password to an
  // account whose owner never set one.
  assert.equal(sender.sent.length, 0);
  assert.equal(result.status, 200);
  world.close();
});

test('with no email provider it refuses plainly instead of pretending', async () => {
  const world = createWorld();
  await withAccount(world);

  const failure = await expectFailure(() =>
    requestPasswordReset(signedOut(world), { email: EMAIL }, null),
  );
  // "Check your inbox" when nothing was dispatched leaves a student waiting
  // instead of asking for help.
  assert.equal(failure.code, 'NOT_FOUND');
  assert.match(failure.message, /not available/i);
  world.close();
});

test('the emailed link points at the app, not the API', async () => {
  const world = createWorld();
  await withAccount(world);
  const sender = recordingSender();
  await requestPasswordReset(signedOut(world), { email: EMAIL }, sender);

  // The token is redeemed by a page the student opens, so the link has to be
  // on the frontend origin. Pointing it at the Worker would show them JSON.
  assert.match(sender.sent[0].text, /https:\/\/app\.test\/reset-password\?token=/);
  assert.ok(T0 > 0);
  world.close();
});
