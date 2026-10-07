import type { EnvironmentSource } from '@pipong/shared';
import { defineEnv } from '@xcvzlabs/env';
import * as v from 'valibot';

export type MailConfig = {
  from: string;
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user: string | undefined;
  password: string | undefined;
};

/**
 * Validates sender and SMTP settings before creating a transport.
 *
 * The default port is 587 and security mode is STARTTLS. Plain SMTP is restricted
 * to loopback hosts; a username and password must be supplied together.
 *
 * @param [source=process.env] - Environment values containing sender and SMTP settings.
 * @returns Normalized sender, connection, TLS, and optional credential settings.
 * @throws {Error} AUTH_MAIL_CONFIG_INVALID when sender or SMTP settings are invalid.
 *
 * @example
 * ```ts
 * const config = loadMailConfig({
 *   AUTH_MAIL_FROM: 'auth@example.com',
 *   SMTP_HOST: 'localhost',
 *   SMTP_SECURITY: 'local',
 * });
 * ```
 */
export function loadMailConfig(source: EnvironmentSource = process.env): MailConfig {
  try {
    const values = defineEnv({
      source,
      schema: {
        AUTH_MAIL_FROM: v.pipe(v.string(), v.email()),
        SMTP_HOST: v.pipe(v.string(), v.trim(), v.nonEmpty()),
        SMTP_PORT: v.optional(
          v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1), v.maxValue(65535)),
          '587',
        ),
        SMTP_SECURITY: v.optional(v.picklist(['starttls', 'tls', 'local']), 'starttls'),
        SMTP_USER: v.optional(v.pipe(v.string(), v.nonEmpty())),
        SMTP_PASSWORD: v.optional(v.pipe(v.string(), v.nonEmpty())),
      },
    });

    if ((values.SMTP_USER === undefined) !== (values.SMTP_PASSWORD === undefined)) {
      throw new Error('SMTP credentials must be supplied together');
    }

    if (
      values.SMTP_SECURITY === 'local' &&
      !['localhost', '127.0.0.1', '::1'].includes(values.SMTP_HOST)
    ) {
      throw new Error('Plain SMTP requires a loopback host');
    }

    return {
      from: values.AUTH_MAIL_FROM,
      host: values.SMTP_HOST,
      port: values.SMTP_PORT,
      secure: values.SMTP_SECURITY === 'tls',
      requireTLS: values.SMTP_SECURITY === 'starttls',
      user: values.SMTP_USER,
      password: values.SMTP_PASSWORD,
    };
  } catch {
    throw new Error('AUTH_MAIL_CONFIG_INVALID: invalid sender or SMTP configuration');
  }
}
