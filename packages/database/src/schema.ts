import { pgSchema } from 'drizzle-orm/pg-core';

/** Internal namespace for tenant and notification tables authored in this package. */
export const appSchema = pgSchema('app');
/** Internal namespace for authentication tables accessed by the API account. */
export const authSchema = pgSchema('auth');
/** Internal namespace reserved for pg-boss queue storage. */
export const queueSchema = pgSchema('pgboss');
