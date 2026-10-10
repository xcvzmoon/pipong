import { environmentPathSchema } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { openEventStream } from '~/utils/event-stream.ts';
import { problemResponse } from '~/utils/problem.ts';

const streamQuerySchema = v.strictObject({
  cursor: v.optional(
    v.pipe(v.string(), v.minLength(1), v.maxLength(1024), v.regex(/^[A-Za-z0-9_-]+$/)),
  ),
});

defineRouteMeta({
  openAPI: {
    operationId: 'streamDeliveryEvents',
    tags: ['events'],
    security: [{ sessionCookie: [] }, { serviceKey: [] }],
    parameters: [
      {
        in: 'path',
        name: 'organizationId',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      { in: 'path', name: 'projectId', required: true, schema: { type: 'string', format: 'uuid' } },
      {
        in: 'path',
        name: 'environmentId',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      {
        in: 'query',
        name: 'cursor',
        schema: { type: 'string', maxLength: 1024, pattern: '^[A-Za-z0-9_-]+$' },
      },
      {
        in: 'header',
        name: 'Last-Event-ID',
        schema: { type: 'string', maxLength: 1024, pattern: '^[A-Za-z0-9_-]+$' },
      },
    ],
    responses: {
      '200': {
        description:
          'Ordered delivery events. Resume with Last-Event-ID; deduplicate by id. Heartbeats are comments. Authorization loss or slow consumption closes the connection.',
        content: { 'text/event-stream': { schema: { type: 'string' } } },
      },
      '401': {
        description: 'Invalid credentials',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '403': {
        description: 'Insufficient authority or disabled organization',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '404': {
        description: 'Scope not found',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '410': {
        description: 'Cursor expired; resynchronize status',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '422': {
        description: 'Invalid query, conflicting cursors, or wrong-stream/future cursor',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '429': {
        description: 'Stream connection capacity exhausted',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
        headers: { 'Retry-After': { schema: { type: 'integer', minimum: 1 } } },
      },
      '503': {
        description: 'Persistence unavailable or server stopping',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const requestId = event.context.requestId ?? 'unavailable';
  const path = v.safeParse(environmentPathSchema, event.context.params);
  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', requestId);
  }
  const query = v.safeParse(streamQuerySchema, Object.fromEntries(event.url.searchParams));
  const header = event.req.headers.get('last-event-id') ?? undefined;
  const cursor = v.safeParse(streamQuerySchema, { cursor: header });
  if (
    !query.success ||
    !cursor.success ||
    new Set(event.url.searchParams.keys()).size !== [...event.url.searchParams].length ||
    (header !== undefined && query.output.cursor !== undefined && header !== query.output.cursor)
  ) {
    return problemResponse(422, 'RESOURCE_INPUT_INVALID', requestId);
  }
  return openEventStream(
    event,
    { kind: 'environment', ...path.output },
    header ?? query.output.cursor,
  );
});
