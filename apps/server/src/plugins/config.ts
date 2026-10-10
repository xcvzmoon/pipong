import { definePlugin } from 'nitro';
import { database, mailQueue } from '../utils/auth.ts';
import { eventStreams } from '../utils/event-stream.ts';

function stopStreams(): void {
  void eventStreams.close();
}

export default definePlugin((nitroApp) => {
  if (!process.env.CI && !process.env.TEST) {
    process.once('SIGTERM', stopStreams);
    process.once('SIGINT', stopStreams);
  }

  nitroApp.hooks.hook('close', async () => {
    process.removeListener('SIGTERM', stopStreams);
    process.removeListener('SIGINT', stopStreams);
    await eventStreams.close();
    try {
      await mailQueue.stop();
    } finally {
      await database.close();
    }
  });
});
