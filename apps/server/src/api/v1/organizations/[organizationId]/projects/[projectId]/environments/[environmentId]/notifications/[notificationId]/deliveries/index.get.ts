import { resourcePageSchema, listNotificationDeliveries } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';

const pathSchema = v.strictObject({
  organizationId: v.pipe(v.string(), v.uuid()),
  projectId: v.pipe(v.string(), v.uuid()),
  environmentId: v.pipe(v.string(), v.uuid()),
  notificationId: v.pipe(v.string(), v.uuid()),
});

defineRouteMeta({
  openAPI: {
    operationId: 'listNotificationDeliveries',
    tags: ['deliveries'],
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
        in: 'path',
        name: 'notificationId',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      {
        in: 'query',
        name: 'limit',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
      {
        in: 'query',
        name: 'cursor',
        schema: { type: 'string', maxLength: 1024, pattern: '^[A-Za-z0-9_-]+$' },
      },
    ],
    responses: {
      '200': {
        description: 'Delivery outcome page',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/DeliveryStatusPage' } },
        },
      },
      '401': {
        description: 'Invalid credentials',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '403': {
        description: 'Insufficient authority',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '404': {
        description: 'Notification not found',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '422': {
        description: 'Invalid path or cursor',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '503': {
        description: 'Persistence unavailable',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          DeliveryStatus: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'provider', 'state'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              provider: { type: 'string', enum: ['apns', 'fcm', 'web-push'] },
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
            },
          },
          DeliveryStatusPage: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor'],
            properties: {
              items: {
                type: 'array',
                maxItems: 100,
                items: { $ref: '#/components/schemas/DeliveryStatus' },
              },
              nextCursor: { type: ['string', 'null'], maxLength: 1024 },
            },
          },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const path = v.safeParse(pathSchema, event.context.params);
  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', event.context.requestId ?? 'unavailable');
  }
  const { notificationId, ...scopePath } = path.output;
  const scope = { kind: 'environment', ...scopePath } as const;
  const input = v.safeParse(resourcePageSchema, Object.fromEntries(event.url.searchParams));
  if (
    !input.success ||
    new Set(event.url.searchParams.keys()).size !== [...event.url.searchParams].length
  ) {
    return problemResponse(422, 'RESOURCE_INPUT_INVALID', event.context.requestId ?? 'unavailable');
  }
  return withAuthorizedRequest(event, 'delivery:read', scope, async (transaction) => {
    const result = await listNotificationDeliveries(
      transaction,
      scope,
      notificationId,
      input.output.limit,
      input.output.cursor,
    );
    if (!result.ok) {
      return problemResponse(result.status, result.code, event.context.requestId ?? 'unavailable');
    }
    return Response.json(result.value);
  });
});
