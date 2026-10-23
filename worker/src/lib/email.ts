/**
 * Transactional email.
 *
 * This platform has never sent an email. That is why there is no password
 * reset and no address verification, and why a forgotten password currently
 * means a permanently lost account — every attempt, bookmark and streak with
 * it. This module is the missing capability, kept deliberately small.
 *
 * A PORT, NOT A PROVIDER
 * ----------------------
 * Everything above this file depends on `EmailSender`, never on Resend. Two
 * reasons, and the second is the real one:
 *
 *   1. The handler and its tests need a sender they can assert against, and a
 *      test that reaches the network is not a test.
 *   2. Email providers are swapped. MailChannels was the obvious choice for
 *      Workers until it withdrew its free service; whatever replaces Resend
 *      should be one file, not a grep through the auth handlers.
 *
 * NOT CONFIGURED IS AN HONEST STATE
 * ---------------------------------
 * With no API key, `resolveEmailSender` returns `null` and the reset endpoints
 * refuse with a plain "not available" — for every caller, whether or not the
 * address exists. They do NOT pretend to have sent something. A reset flow
 * that returns "check your inbox" when nothing was dispatched is worse than
 * one that is switched off, because the student waits instead of asking for
 * help.
 */

import type { Env } from '../env.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. Required: some clients render nothing else, and it is what a screen reader reads. */
  text: string;
  /** Optional HTML alternative. */
  html?: string;
}

export interface EmailSender {
  /** Resolves on success, throws on a provider error. */
  send(message: EmailMessage): Promise<void>;
  /** For logs and tests. */
  readonly name: string;
}

/** Injected so tests do not reach the network. */
export type FetchLike = typeof fetch;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Resend.
 *
 * Chosen because it works from a Worker with one `fetch` and no SDK, which
 * matters when the whole bundle has to stay inside a Worker's size budget.
 */
export function resendSender(args: {
  apiKey: string;
  from: string;
  fetchImpl?: FetchLike;
}): EmailSender {
  const doFetch = args.fetchImpl ?? fetch;
  return {
    name: 'resend',
    async send(message: EmailMessage): Promise<void> {
      const response = await doFetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${args.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: args.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html === undefined ? {} : { html: message.html }),
        }),
      });

      if (!response.ok) {
        // The body can quote the recipient address, so it is summarised rather
        // than forwarded. The caller turns this into a generic failure; it
        // must never reach a response body, or the reset endpoint becomes an
        // address-validity oracle.
        const detail = await response.text().catch(() => '');
        throw new Error(
          `resend rejected the message: ${String(response.status)} ${detail.slice(0, 200)}`,
        );
      }
    },
  };
}

/**
 * The sender for this deployment, or `null` when email is not configured.
 *
 * Both values or neither. A key with no `from` address cannot send and a
 * `from` with no key is decoration, so a half-configuration is treated as off
 * — the same rule, and for the same reason, as the Google OAuth triple in
 * `env.ts`: an optional capability must never half-work.
 */
export function resolveEmailSender(env: Env, fetchImpl?: FetchLike): EmailSender | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return resendSender({ apiKey, from, fetchImpl });
}

/**
 * The reset email.
 *
 * Plain text only. An HTML email from a study platform buys nothing, and a
 * link that renders as link text is one a phishing-aware student can actually
 * inspect before clicking.
 */
export function passwordResetMessage(args: {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}): EmailMessage {
  return {
    to: args.to,
    subject: 'Reset your NECPrep password',
    text: [
      'Someone asked to reset the password for this NECPrep account.',
      '',
      'To set a new one, open this link:',
      args.resetUrl,
      '',
      `The link works once and expires in ${String(args.expiresInMinutes)} minutes.`,
      '',
      'If this was not you, you can ignore this email. Your password has not',
      'changed, and nobody can use the link without this message.',
    ].join('\n'),
  };
}
