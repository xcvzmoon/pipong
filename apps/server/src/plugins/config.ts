import { definePlugin } from 'nitro';
import { database, mailQueue } from '../utils/auth.ts';

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('close', async () => {
    try {
      await mailQueue.stop();
    } finally {
      await database.close();
    }
  });
});
