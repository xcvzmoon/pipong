import { useWorkerDb } from '@pipong/database';
import { startDeliveryQueue } from '@pipong/database/delivery-queue';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:http2';
import * as v from 'valibot';
import { runDeliveryConsumer } from '../../../../packages/service/src/delivery-consumer.ts';
import { createApnsRuntime } from '../../../../packages/service/src/providers/apns.ts';

const origin = v.parse(v.string(), process.env.QUALIFICATION_PROVIDER_ORIGIN);
const keyring = v.parse(v.string(), process.env.CREDENTIAL_KEYRING_REF);
const certificate = await readFile(
  new URL('../../../../packages/service/tests/fixtures/push-cert.pem', import.meta.url),
);
const database = await useWorkerDb();
const queue = await startDeliveryQueue(database, 'worker');
const runtime = createApnsRuntime(() =>
  connect(origin, { ca: certificate, servername: 'push.test' }),
);
const controller = new AbortController();
process.on('SIGTERM', () => {
  controller.abort();
});
process.on('SIGINT', () => {
  controller.abort();
});
try {
  await runDeliveryConsumer(
    database,
    queue,
    { provider: 'apns', runtime },
    keyring,
    controller.signal,
  );
} finally {
  runtime.close();
  await queue.stop({ graceful: true });
  await database.close();
}
