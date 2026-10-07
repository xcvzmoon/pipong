import type { DatabaseRuntime } from '@pipong/database';
import type { ApiConfig } from '@pipong/shared';
import type { PgBoss } from 'pg-boss';
import { authTransactionQueue } from '@pipong/database';
import {
  createAuthClient,
  withEnrollmentTransaction,
  readEnrollmentState,
  insertEnrollmentAudit,
} from '@pipong/database/auth';
import * as v from 'valibot';
import { createAuthEngine } from './auth.ts';
import { authMailQueueName } from './mail/queue.ts';

export type EnrollmentAction = v.InferOutput<typeof enrollmentActionSchema>;
export type EnrollmentResult = {
  userId: string;
  organizationId: string | null;
};

export const enrollmentActionSchema = v.variant('action', [
  v.object({
    action: v.literal('bootstrap'),
    name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
    email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email()),
    password: v.pipe(v.string(), v.minLength(12), v.maxLength(128)),
    organizationName: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
    organizationSlug: v.pipe(v.string(), v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  }),
  v.object({
    action: v.literal('provision'),
    name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
    email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email()),
    password: v.pipe(v.string(), v.minLength(12), v.maxLength(128)),
  }),
]);

export function enrollAccount(
  database: DatabaseRuntime,
  config: ApiConfig,
  queue: PgBoss,
  action: EnrollmentAction,
): Promise<EnrollmentResult> {
  return withEnrollmentTransaction(createAuthClient(database), async (transaction) => {
    const state = await readEnrollmentState(transaction, action.email);

    if (action.action === 'bootstrap' && (state.hasOrganization || state.hasUser)) {
      throw new Error('AUTH_BOOTSTRAP_CLOSED: bootstrap requires an empty installation');
    }

    if (action.action === 'provision' && !state.hasOrganization) {
      throw new Error('AUTH_BOOTSTRAP_REQUIRED: bootstrap an organization before provisioning');
    }

    if (state.accountExists) {
      throw new Error('AUTH_ACCOUNT_EXISTS: account already exists');
    }

    const auth = createAuthEngine(
      transaction,
      config,
      async (mail) => {
        const id = await queue.send(authMailQueueName, mail, {
          db: authTransactionQueue(transaction),
        });

        if (!id) {
          throw new Error('AUTH_MAIL_ENQUEUE_FAILED: email was not queued');
        }
      },
      'operator',
    );

    const created = await auth.api.signUpEmail({
      body: {
        name: action.name,
        email: action.email,
        password: action.password,
      },
    });

    let organizationId: string | null = null;

    if (action.action === 'bootstrap') {
      const createdOrganization = await auth.api.createOrganization({
        body: {
          name: action.organizationName,
          slug: action.organizationSlug,
          userId: created.user.id,
        },
      });

      organizationId = createdOrganization?.id ?? null;

      if (!organizationId) {
        throw new Error('AUTH_BOOTSTRAP_FAILED: organization was not created');
      }
    }

    await insertEnrollmentAudit(transaction, {
      action: action.action,
      userId: created.user.id,
      sessionId: null,
    });

    return {
      organizationId,
      userId: created.user.id,
    };
  });
}
