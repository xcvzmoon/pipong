import { replayDeliveryEvents, environmentPathSchema, resourcePageSchema } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'replayDeliveryEvents',
    tags: ['events'],
    security: [
      {
        sessionCookie: [],
      },
      {
        serviceKey: [],
      },
    ],
    parameters: [
      {
        in: 'path',
        name: 'organizationId',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
        },
      },
      {
        in: 'path',
        name: 'projectId',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
        },
      },
      {
        in: 'path',
        name: 'environmentId',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
        },
      },
      {
        in: 'query',
        name: 'limit',
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 50,
        },
      },
      {
        in: 'query',
        name: 'cursor',
        schema: {
          type: 'string',
          maxLength: 1024,
          pattern: '^[A-Za-z0-9_-]+$',
        },
      },
    ],
    $global: {
      components: {
        schemas: {
          DeliveryEvent: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'notificationId', 'deliveryId', 'state', 'createdAt'],
            properties: {
              id: { type: 'string', maxLength: 1024, pattern: '^[A-Za-z0-9_-]+$' },
              notificationId: { type: 'string', format: 'uuid' },
              deliveryId: { type: 'string', format: 'uuid' },
              state: {
                type: 'string',
                enum: [
                  'queued',
                  'sending',
                  'retry_wait',
                  'provider_accepted',
                  'failed',
                  'expired',
                  'canceled',
                ],
              },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
          EventPage: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor', 'watermark', 'hasMore'],
            properties: {
              items: {
                type: 'array',
                maxItems: 100,
                items: { $ref: '#/components/schemas/DeliveryEvent' },
              },
              nextCursor: { type: 'string', maxLength: 1024, pattern: '^[A-Za-z0-9_-]+$' },
              watermark: { type: 'string', maxLength: 1024, pattern: '^[A-Za-z0-9_-]+$' },
              hasMore: { type: 'boolean' },
            },
          },
        },
      },
    },
    responses: {
      '401': {
        description: 'Invalid credentials',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '403': {
        description: 'Insufficient authority',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '404': {
        description: 'Environment not found',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '409': {
        description: 'Suspended scope or deleted identity',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '410': {
        description: 'Replay cursor expired; resynchronize delivery status',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '422': {
        description: 'Invalid input or cursor',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '503': {
        description: 'Persistence unavailable',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '200': {
        description: 'Retained delivery events',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/EventPage',
            },
          },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const path = v.safeParse(environmentPathSchema, event.context.params);

  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', event.context.requestId ?? 'unavailable');
  }

  const { organizationId, projectId, environmentId } = path.output;
  const scope = { kind: 'environment', organizationId, projectId, environmentId } as const;
  const input = v.safeParse(resourcePageSchema, Object.fromEntries(event.url.searchParams));

  if (
    !input.success ||
    new Set(event.url.searchParams.keys()).size !== [...event.url.searchParams].length
  ) {
    return problemResponse(422, 'RESOURCE_INPUT_INVALID', event.context.requestId ?? 'unavailable');
  }

  return withAuthorizedRequest(event, 'event:read', scope, async (transaction) => {
    const result = await replayDeliveryEvents(
      transaction,
      scope,
      input.output.limit,
      input.output.cursor,
    );

    if (!result.ok) {
      return problemResponse(result.status, result.code, event.context.requestId ?? 'unavailable');
    }
    return Response.json(result.value);
  });
});
