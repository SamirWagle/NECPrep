/**
 * Worker bindings and configuration.
 *
 * Configuration FAILS CLOSED. A missing secret throws at request time with the
 * name of the variable, rather than falling back to a development default that
 * would silently ship a predictable permutation secret or an open CORS policy.
 * The cost is that a misconfigured deployment 500s on every request, which is
 * the correct failure mode.
 */

import type { D1Database } from './data/d1.ts';
import { ApiException } from './shared/errors.ts';

export interface Env {
  /** The D1 binding. Declared in wrangler.toml by whoever owns that file. */
  DB: D1Database;

  /** Origin the browser app is served from. Drives CORS and OAuth redirects. */
  APP_ORIGIN: string;

  /**
   * Seeds the stable option permutation used by the content-browsing
   * endpoints. Rotating it reshuffles every browse order, which is harmless.
   * It must not be guessable: with it, the permutation applied to a given
   * (user, question) can be reproduced offline and joined against the public
   * chapter JSON in git history.
   */
  CONTENT_PERMUTATION_SECRET: string;

  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Must exactly match the authorised redirect URI in Google Cloud console. */
  GOOGLE_REDIRECT_URI?: string;

  ENVIRONMENT?: string;
  /** Default 100000. Raise to 600000 on the paid plan. See lib/password.ts. */
  PASSWORD_HASH_ITERATIONS?: string;
  /** Default 45. Raise to ~900 on the paid plan (1,000 queries/invocation). */
  D1_QUERY_BUDGET?: string;
  /**
   * Transactional email. BOTH or neither - a key with no sender address
   * cannot send and an address with no key is decoration, so a
   * half-configuration is treated as off, exactly as the Google triple is.
   * Without them the password-reset endpoints refuse plainly rather than
   * pretending to have sent something. See lib/email.ts.
   */
  RESEND_API_KEY?: string;
  /** e.g. `NECPrep <noreply@yourdomain>`. Must be a verified Resend sender. */
  EMAIL_FROM?: string;

  /**
   * Raw-answer retention window in days, read by the retention cron. Default
   * 90 on the free plan; 180 once on Workers Paid. See the archival note in
   * migrations/0004_assessment.sql and `src/jobs/index.ts#retentionDays`.
   */
  ANSWER_RETENTION_DAYS?: string;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface Config {
  appOrigin: string;
  permutationSecret: string;
  passwordIterations: number;
  queryBudget: number;
  isProduction: boolean;
  /** `null` when Google OAuth is not configured; those routes then 404. */
  google: GoogleOAuthConfig | null;
  /**
   * Set when SOME but not all of the three Google values were supplied.
   *
   * Distinct from `google === null` with no error, which means "deliberately
   * not configured". A half-configured OAuth app is a mistake someone is
   * actively making, and the Google routes say so rather than reporting the
   * feature as absent.
   */
  googleConfigError: string | null;
}

function required(env: Env, key: 'APP_ORIGIN' | 'CONTENT_PERMUTATION_SECRET'): string {
  const value = env[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiException('INTERNAL', 'Server is not configured.', {
      internal: `Missing required environment variable ${key}.`,
    });
  }
  return value.trim();
}

function intOr(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ApiException('INTERNAL', 'Server is not configured.', {
      internal: `Invalid numeric configuration value ${raw}; expected ${min}..${max}.`,
    });
  }
  return n;
}

export function loadConfig(env: Env): Config {
  const appOrigin = required(env, 'APP_ORIGIN');
  const permutationSecret = required(env, 'CONTENT_PERMUTATION_SECRET');

  if (permutationSecret.length < 32) {
    throw new ApiException('INTERNAL', 'Server is not configured.', {
      internal: 'CONTENT_PERMUTATION_SECRET must be at least 32 characters.',
    });
  }

  // All three Google values or none. A half-configured OAuth app produces a
  // redirect_uri_mismatch at Google, which is a confusing place to debug it.
  //
  // This used to THROW, and that was wrong in a way only a real deployment
  // showed: `loadConfig` runs in the `/api/*` middleware, so one missing
  // Google value 500'd every endpoint on the platform — chapters, guest
  // sign-in, submitting a paper — each reporting "Google OAuth needs...",
  // which is a baffling thing to read when you asked for a chapter list.
  //
  // An optional feature must not be able to take down a required one. The
  // misconfiguration is recorded instead, and the three Google handlers (which
  // already guard on `google === null`) are the only place it surfaces.
  const googleParts = [
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  ];
  const googleSet = googleParts.filter((p) => typeof p === 'string' && p.trim().length > 0).length;
  const googleConfigError =
    googleSet === 0 || googleSet === 3
      ? null
      : `Google OAuth needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ` +
        `GOOGLE_REDIRECT_URI together, or none of them; ${String(googleSet)} of 3 are set.`;

  return {
    appOrigin,
    permutationSecret,
    passwordIterations: intOr(env.PASSWORD_HASH_ITERATIONS, 100_000, 10_000, 1_000_000),
    queryBudget: intOr(env.D1_QUERY_BUDGET, 45, 5, 990),
    isProduction: env.ENVIRONMENT !== 'development',
    google:
      googleSet === 3
        ? {
            clientId: (env.GOOGLE_CLIENT_ID as string).trim(),
            clientSecret: (env.GOOGLE_CLIENT_SECRET as string).trim(),
            redirectUri: (env.GOOGLE_REDIRECT_URI as string).trim(),
          }
        : null,
    googleConfigError,
  };
}
