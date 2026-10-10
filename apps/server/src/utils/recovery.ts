import type { H3Event } from 'nitro/h3';
import * as v from 'valibot';
import { problemResponse } from './problem.ts';

const redriveInputSchema = v.strictObject({
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
  reason: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500)),
});

export async function readRedriveInput(
  event: H3Event,
): Promise<v.InferOutput<typeof redriveInputSchema> | Response> {
  const requestId = event.context.requestId ?? 'unavailable';
  if (
    event.req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    return problemResponse(415, 'RESOURCE_CONTENT_TYPE_INVALID', requestId);
  }
  const reader = event.req.body?.getReader();
  if (!reader) {
    return problemResponse(422, 'DELIVERY_REDRIVE_INVALID', requestId);
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
      if (bytes > 4096) {
        await reader.cancel();
        return problemResponse(413, 'RESOURCE_BODY_TOO_LARGE', requestId);
      }
      chunks.push(chunk.value);
    }
    // oxlint-enable eslint/no-await-in-loop
    const parsed = v.safeParse(
      redriveInputSchema,
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
    );
    if (!parsed.success) {
      return problemResponse(422, 'DELIVERY_REDRIVE_INVALID', requestId);
    }
    return parsed.output;
  } catch {
    return problemResponse(422, 'DELIVERY_REDRIVE_INVALID', requestId);
  } finally {
    reader.releaseLock();
  }
}
