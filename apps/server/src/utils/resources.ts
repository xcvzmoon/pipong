import type { ResourceResult } from '@pipong/service';
import type { H3Event } from 'nitro/h3';
import { resourceInputSchema } from '@pipong/service';
import { assertBodySize, HTTPError } from 'nitro/h3';
import * as v from 'valibot';
import { problemResponse } from './problem.ts';

export async function readResourceInput(event: H3Event): Promise<{ name: string } | Response> {
  const requestId = event.context.requestId ?? 'unavailable';

  if (
    event.req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    return problemResponse(415, 'RESOURCE_CONTENT_TYPE_INVALID', requestId);
  }

  try {
    assertBodySize(event, 4096);
    const parsed = v.safeParse(resourceInputSchema, await event.req.json());

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

export function resourceResponse<Value>(
  event: H3Event,
  result: ResourceResult<Value>,
  status = 200,
): Response {
  if (!result.ok) {
    return problemResponse(result.status, result.code, event.context.requestId ?? 'unavailable');
  }

  return Response.json(result.value, { status });
}
