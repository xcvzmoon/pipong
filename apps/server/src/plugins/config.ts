import { openDatabase, parseDatabaseUrl } from '@pipong/database';
import { loadApiConfig } from '@pipong/shared';
import { definePlugin } from 'nitro';

const config = loadApiConfig();
const database = await openDatabase(
  parseDatabaseUrl(process.env, 'DATABASE_URL'),
  config.databasePoolMax,
  'pipong_api',
);

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('close', database.close);
});
