import type { PgBoss } from 'pg-boss';
import type { AuthMail } from './payload.ts';
import { authMailQueueName } from './runtime.ts';

export async function enqueueAuthMail(queue: PgBoss, mail: AuthMail): Promise<void> {
  const id = await queue.send(authMailQueueName, mail);

  if (!id) throw new Error('AUTH_MAIL_ENQUEUE_FAILED: email was not queued');
}
