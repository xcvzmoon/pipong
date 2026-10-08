import type { EndpointInput } from '@pipong/service';
import type { H3Event } from 'nitro/h3';
import { endpointInputSchema, endpointDisableSchema } from '@pipong/service';
import { assertBodySize, HTTPError } from 'nitro/h3';
import * as v from 'valibot';
import { problemResponse } from './problem.ts';

export async function readEndpointInput(event: H3Event): Promise<EndpointInput | Response> {
  return readEndpointBody(event, endpointInputSchema);
}

export async function readEndpointDisableInput(
  event: H3Event,
): Promise<{ generation: number } | Response> {
  return readEndpointBody(event, endpointDisableSchema);
}

async function readEndpointBody<Schema extends v.GenericSchema>(
  event: H3Event,
  schema: Schema,
): Promise<v.InferOutput<Schema> | Response> {
  const requestId = event.context.requestId ?? 'unavailable';
  if (
    event.req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    return problemResponse(415, 'RESOURCE_CONTENT_TYPE_INVALID', requestId);
  }
  try {
    assertBodySize(event, 16384);
    const parsed = v.safeParse(schema, await event.req.json());
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
