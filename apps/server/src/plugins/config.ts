import { useApiDb } from '@pipong/database';
import { loadApiConfig } from '@pipong/shared';
import { definePlugin } from 'nitro';

loadApiConfig();
const database = await useApiDb();

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('close', database.close);
});
