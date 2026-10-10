import {
  environmentPathSchema,
  resourcePageSchema,
  listNotificationSummaries,
} from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'listNotifications',
    tags: ['notifications'],
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
        description: 'Notification status page',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/NotificationPage' } },
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
        description: 'Environment not found',
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
          NotificationSummary: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'acceptedAt',
              'expiresAt',
              'canceledAt',
              'deliveryCount',
              'counts',
              'providerAcceptance',
            ],
            properties: {
              id: { type: 'string', format: 'uuid' },
              acceptedAt: { type: 'string', format: 'date-time' },
              expiresAt: { type: 'string', format: 'date-time' },
              canceledAt: { type: ['string', 'null'], format: 'date-time' },
              deliveryCount: { type: 'integer', minimum: 0 },
              counts: {
                type: 'object',
                additionalProperties: false,
                required: ['pending', 'providerAccepted', 'failed', 'expired', 'canceled'],
                properties: {
                  pending: { type: 'integer' },
                  providerAccepted: { type: 'integer' },
                  failed: { type: 'integer' },
                  expired: { type: 'integer' },
                  canceled: { type: 'integer' },
                },
              },
              providerAcceptance: {
                type: 'object',
                additionalProperties: false,
                required: ['apns', 'fcm', 'webPush'],
                properties: {
                  apns: { type: 'integer' },
                  fcm: { type: 'integer' },
                  webPush: { type: 'integer' },
                },
              },
            },
          },
          NotificationPage: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor'],
            properties: {
              items: {
                type: 'array',
                maxItems: 100,
                items: { $ref: '#/components/schemas/NotificationSummary' },
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
  const path = v.safeParse(environmentPathSchema, event.context.params);
  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', event.context.requestId ?? 'unavailable');
  }
  const scope = { kind: 'environment', ...path.output } as const;
  const input = v.safeParse(resourcePageSchema, Object.fromEntries(event.url.searchParams));
  if (
    !input.success ||
    new Set(event.url.searchParams.keys()).size !== [...event.url.searchParams].length
  ) {
    return problemResponse(422, 'RESOURCE_INPUT_INVALID', event.context.requestId ?? 'unavailable');
  }
  return withAuthorizedRequest(event, 'notification:read', scope, async (transaction) => {
    const result = await listNotificationSummaries(
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
