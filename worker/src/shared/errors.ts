/**
 * The one way this API fails.
 *
 * Handlers throw `ApiException`; the Hono error middleware and the test harness
 * both turn it into the same `{ error: { code, message } }` body with the same
 * status. Nothing else is ever surfaced to a client: an unexpected throw becomes
 * a bare `INTERNAL`, because a D1 error message can contain SQL and column
 * names and sometimes row values.
 */

import type { ApiError, ApiErrorBody, ApiErrorCode } from './types.ts';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  IDEMPOTENCY_KEY_REUSED: 409,
  REQUEST_IN_FLIGHT: 409,
  ATTEMPT_NOT_IN_PROGRESS: 409,
  QUESTION_NOT_ON_PAPER: 422,
  UNKNOWN_OPTION_REF: 422,
  EMAIL_IN_USE: 409,
  INVALID_CREDENTIALS: 401,
  NOT_ANONYMOUS: 409,
  OAUTH_STATE_INVALID: 400,
  OAUTH_EXCHANGE_FAILED: 502,
  INSUFFICIENT_CONTENT: 409,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
  // Client-synthesised; the Worker never returns these. Mapped anyway so the
  // record stays exhaustive and adding a code cannot silently skip a status.
  BACKEND_NOT_CONFIGURED: 501,
  NETWORK_UNAVAILABLE: 503,
};

export interface ApiExceptionInit {
  fields?: Record<string, string>;
  retryAfterMs?: number;
  /** Logged, never returned. For the genuine cause behind a generic code. */
  internal?: string;
}

export class ApiException extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly retryAfterMs?: number;
  readonly internal?: string;

  constructor(code: ApiErrorCode, message: string, init: ApiExceptionInit = {}) {
    super(message);
    this.name = 'ApiException';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fields = init.fields;
    this.retryAfterMs = init.retryAfterMs;
    this.internal = init.internal;
  }

  toBody(): ApiErrorBody {
    const error: ApiError = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    if (this.retryAfterMs !== undefined) error.retryAfterMs = this.retryAfterMs;
    return { error };
  }
}

export function fail(
  code: ApiErrorCode,
  message: string,
  init?: ApiExceptionInit,
): never {
  throw new ApiException(code, message, init);
}

export function statusForCode(code: ApiErrorCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * Turns anything thrown inside a handler into a client-safe response pair.
 *
 * Fails closed: an unrecognised throw is a 500 `INTERNAL` with a fixed message,
 * and the real text is handed back separately for the log.
 */
export function toErrorResponse(err: unknown): {
  status: number;
  body: ApiErrorBody;
  logMessage: string;
} {
  if (err instanceof ApiException) {
    return {
      status: err.status,
      body: err.toBody(),
      logMessage: err.internal ?? err.message,
    };
  }
  const logMessage = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: 'Something went wrong.' } },
    logMessage,
  };
}
