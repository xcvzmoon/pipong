import type { PgBoss } from 'pg-boss';
import type { MailConfig } from './config.ts';
import * as v from 'valibot';
import { authMailSchema } from './payload.ts';
import { renderAuthMail } from './render.ts';
import { authMailQueueName } from './runtime.ts';
import { createMailTransport } from './transport.ts';

/**
 * Registers auth email delivery on a running queue and returns SMTP transport cleanup.
 * Stop the queue and let in-flight jobs finish before calling the returned function.
 */
export async function startAuthMailWorker(
  queue: PgBoss,
  config: MailConfig,
): Promise<() => Promise<void>> {
  const email = createMailTransport(config);

  try {
    await queue.work(
      authMailQueueName,
      { batchSize: 1, pollingIntervalSeconds: 1 },
      async (jobs) => {
        const job = jobs[0];
        if (!job) {
          return;
        }

        const parsed = v.safeParse(authMailSchema, job.data);
        if (!parsed.success) {
          console.error('AUTH_MAIL_INVALID: canceling invalid email job');
          await queue.cancel(authMailQueueName, job.id);
          return;
        }

        const mail = parsed.output;
        if (mail.expiresAt <= Date.now()) {
          await queue.cancel(authMailQueueName, job.id);
          return;
        }

        const result = await email.send({
          ...renderAuthMail(mail),
          to: mail.to,
          headers: {
            'Message-ID': `<${job.id}@pipong>`,
          },
        });

        if (result.error) {
          if (!result.error.retryable) {
            console.error('AUTH_MAIL_SEND_FAILED: canceling permanently rejected email');
            await queue.cancel(authMailQueueName, job.id);
            return;
          }

          throw new Error('AUTH_MAIL_SEND_FAILED: temporary transport failure');
        }
      },
    );
  } catch (error) {
    await email.dispose();
    throw error;
  }

  return () => email.dispose();
}
