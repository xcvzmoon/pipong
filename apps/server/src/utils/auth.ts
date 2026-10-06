import type { DatabaseRuntime } from '@pipong/database';
import { createAuth, startMailQueue } from '@pipong/auth';
import { useApiDb } from '@pipong/database';
import { loadApiConfig } from '@pipong/shared';

type MailQueue = Awaited<ReturnType<typeof startMailQueue>>;
type AuthRuntime = {
  database: DatabaseRuntime;
  mailQueue: MailQueue;
  auth: ReturnType<typeof createAuth>;
};

async function initializeAuth(): Promise<AuthRuntime> {
  const config = loadApiConfig();
  const database = await useApiDb();
  let mailQueue: MailQueue | undefined;
  try {
    mailQueue = await startMailQueue(database);
    return { database, mailQueue, auth: createAuth(database, config, mailQueue) };
  } catch (error) {
    try {
      await mailQueue?.stop();
    } finally {
      await database.close();
    }
    throw error;
  }
}

export const { database, mailQueue, auth } = await initializeAuth();
