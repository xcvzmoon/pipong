import { defineConfig } from 'drizzle-kit';
import * as v from 'valibot';
import config from './drizzle.config.ts';

const url = v.parse(v.pipe(v.string(), v.url()), process.env.MIGRATION_DATABASE_URL);

export default defineConfig({ ...config, dbCredentials: { url } });
