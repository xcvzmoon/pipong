import type {
  ServiceKeyActor,
  ServiceKeyInput,
  ServiceKeyResult,
  ServiceKeyRotation,
} from '@pipong/service';
import type { H3Event } from 'nitro/h3';
import { serviceKeyInputSchema, serviceKeyRotationSchema } from '@pipong/service';
import { assertBodySize, HTTPError } from 'nitro/h3';
import * as v from 'valibot';
import { problemResponse } from './problem.ts';

export function serviceKeyActor(event: H3Event): ServiceKeyActor | Response {
  const principal = event.context.principal;

  if (principal?.kind !== 'human') {
    return problemResponse(403, 'AUTH_PERMISSION_DENIED', event.context.requestId ?? 'unavailable');
  }

  return principal;
}

export function readServiceKeyInput(event: H3Event): Promise<ServiceKeyInput | Response> {
  return readKeyBody(event, serviceKeyInputSchema);
}

export function readServiceKeyRotation(event: H3Event): Promise<ServiceKeyRotation | Response> {
  return readKeyBody(event, serviceKeyRotationSchema);
}

async function readKeyBody<
  Schema extends typeof serviceKeyInputSchema | typeof serviceKeyRotationSchema,
>(event: H3Event, schema: Schema): Promise<v.InferOutput<Schema> | Response> {
  const requestId = event.context.requestId ?? 'unavailable';

  if (
    event.req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    return problemResponse(415, 'RESOURCE_CONTENT_TYPE_INVALID', requestId);
  }

  try {
    assertBodySize(event, 4096);
    const parsed = v.safeParse(schema, await event.req.json());

    if (!parsed.success) {
      return problemResponse(422, 'SERVICE_KEY_INPUT_INVALID', requestId);
    }

    return parsed.output;
  } catch (error) {
    if (error instanceof HTTPError && error.status === 413) {
      return problemResponse(413, 'RESOURCE_BODY_TOO_LARGE', requestId);
    }

    return problemResponse(422, 'SERVICE_KEY_INPUT_INVALID', requestId);
  }
}

export function serviceKeyResponse<Value>(
  event: H3Event,
  result: ServiceKeyResult<Value>,
  status = 200,
): Response {
  if (!result.ok) {
    return problemResponse(result.status, result.code, event.context.requestId ?? 'unavailable');
  }

  return Response.json(result.value, { status });
}
