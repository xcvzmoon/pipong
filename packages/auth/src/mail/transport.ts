import type { MailConfig } from './config.ts';
import { createEmail } from 'unemail';
import smtp from 'unemail/drivers/smtp';

export function createMailTransport(config: MailConfig): ReturnType<typeof createEmail> {
  return createEmail({
    driver: smtp({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTLS,
      user: config.user,
      password: config.password,
      connectionTimeoutMs: 10_000,
      commandTimeoutMs: 10_000,
    }),
    defaults: {
      from: config.from,
    },
  });
}
