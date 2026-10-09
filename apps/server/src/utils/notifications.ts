import type { NotificationRequest } from '@pipong/service';
import type { H3Event } from 'nitro/h3';
import { notificationLimits, notificationRequestSchema } from '@pipong/service';
import * as v from 'valibot';
import { problemResponse } from './problem.ts';

export async function readNotificationInput(
  event: H3Event,
): Promise<NotificationRequest | Response> {
  const requestId = event.context.requestId ?? 'unavailable';
  if (
    event.req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    return problemResponse(415, 'RESOURCE_CONTENT_TYPE_INVALID', requestId);
  }
  const reader = event.req.body?.getReader();
  if (!reader) {
    return problemResponse(422, 'NOTIFICATION_INVALID', requestId);
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    // oxlint-disable eslint/no-await-in-loop -- Read and bound each streaming chunk before buffering the next one.
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > notificationLimits.bodyBytes) {
        await reader.cancel();
        return problemResponse(413, 'NOTIFICATION_BODY_TOO_LARGE', requestId);
      }
      chunks.push(chunk.value);
    }
    // oxlint-enable eslint/no-await-in-loop
    const parsed = v.safeParse(
      notificationRequestSchema,
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
    );
    if (!parsed.success) {
      return problemResponse(422, 'NOTIFICATION_INVALID', requestId);
    }
    return parsed.output;
  } catch {
    return problemResponse(422, 'NOTIFICATION_INVALID', requestId);
  } finally {
    reader.releaseLock();
  }
}
