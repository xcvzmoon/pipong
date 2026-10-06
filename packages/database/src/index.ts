import { drizzle } from 'drizzle-orm/node-postgres';
import { EnhancedQueryLogger } from 'drizzle-query-logger';
import { Pool } from 'pg';
import { env } from './env.ts';

export const db = drizzle({
  client: new Pool({ connectionString: env.database.url }),
  logger: env.flags.useQueryLogger && new EnhancedQueryLogger(),
});
