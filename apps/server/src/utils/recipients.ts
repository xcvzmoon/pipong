import type { H3Event } from 'nitro/h3';
import { recipientInputSchema } from '@pipong/service';
import { assertBodySize, HTTPError } from 'nitro/h3';
import * as v from 'valibot';
import { problemResponse } from './problem.ts';

export async function readRecipientInput(
  event: H3Event,
): Promise<{ externalId: string } | Response> {
  const requestId = event.context.requestId ?? 'unavailable';

  if (
    event.req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    return problemResponse(415, 'RESOURCE_CONTENT_TYPE_INVALID', requestId);
  }

  try {
    assertBodySize(event, 4096);
    const parsed = v.safeParse(recipientInputSchema, await event.req.json());

    if (!parsed.success) {
      return problemResponse(422, 'RESOURCE_INPUT_INVALID', requestId);
    }

    return parsed.output;
  } catch (error) {
    if (error instanceof HTTPError && error.status === 413) {
      return problemResponse(413, 'RESOURCE_BODY_TOO_LARGE', requestId);
    }

    return problemResponse(422, 'RESOURCE_INPUT_INVALID', requestId);
  }
}
