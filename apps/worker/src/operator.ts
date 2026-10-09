import { enrollAccount, enrollmentActionSchema } from '@pipong/auth';
import { startQueue, useApiDb } from '@pipong/database';
import { loadApiConfig } from '@pipong/shared';
import { createInterface } from 'node:readline';
import * as v from 'valibot';

async function readAction(): Promise<v.InferOutput<typeof enrollmentActionSchema>> {
  if (process.argv.length !== 2 || process.stdin.isTTY) {
    throw new Error('AUTH_OPERATOR_INPUT_REQUIRED: provide enrollment JSON through stdin');
  }

  const reader = createInterface({ input: process.stdin });
  const lines: string[] = [];

  let length = 0;

  try {
    for await (const line of reader) {
      length += Buffer.byteLength(line) + 1;

      if (length > 16_384) {
        throw new Error('AUTH_OPERATOR_INPUT_INVALID: input exceeds 16 KiB');
      }

      lines.push(line);
    }

    const parsed = v.safeParse(enrollmentActionSchema, JSON.parse(lines.join('\n')));

    if (!parsed.success) {
      throw new Error('AUTH_OPERATOR_INPUT_INVALID: invalid enrollment JSON');
    }

    return parsed.output;
  } finally {
    reader.close();
    process.stdin.destroy();
  }
}

try {
  const action = await readAction();
  const config = loadApiConfig();
  const database = await useApiDb();

  try {
    const queue = await startQueue(database, 'producer');

    try {
      const account = await enrollAccount(database, config, queue, action);
      const stringifiedAccount = JSON.stringify(account);

      console.info(stringifiedAccount);
    } finally {
      await queue.stop({ graceful: true, timeout: 30_000 });
    }
  } finally {
    await database.close();
  }
} catch (error) {
  const code = error instanceof Error ? /^AUTH_[A-Z_]+/.exec(error.message)?.[0] : undefined;

  console.error(code ?? 'AUTH_OPERATOR_FAILED');
  process.exitCode = 1;
}
