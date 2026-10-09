import { environmentPathSchema, idempotencyKeySchema, submitNotification } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { mailQueue } from '~/utils/auth.ts';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { credentialKeyring } from '~/utils/credentials.ts';
import { readNotificationInput } from '~/utils/notifications.ts';
import { problemResponse } from '~/utils/problem.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'submitNotification',
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
        in: 'header',
        name: 'Idempotency-Key',
        required: true,
        schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,200}$' },
        description:
          'Environment-scoped seven-day replay key. Same canonical request returns the original acceptance.',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/NotificationRequest' } },
      },
    },
    // oxlint-disable unicorn/no-thenable -- JSON Schema conditionals require the then keyword.
    $global: {
      components: {
        schemas: {
          NotificationRequest: {
            type: 'object',
            additionalProperties: false,
            required: ['targets', 'content', 'expiresAt'],
            properties: {
              targets: {
                oneOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'ids'],
                    properties: {
                      kind: { const: 'recipients' },
                      ids: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 100,
                        items: { type: 'string', format: 'uuid' },
                      },
                    },
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'ids'],
                    properties: {
                      kind: { const: 'endpoints' },
                      ids: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 1000,
                        items: { type: 'string', format: 'uuid' },
                      },
                    },
                  },
                ],
              },
              content: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  alert: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['title', 'body'],
                    properties: {
                      title: { type: 'string', minLength: 1 },
                      body: { type: 'string', minLength: 1 },
                    },
                  },
                  data: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                    propertyNames: {
                      type: 'string',
                      minLength: 1,
                      pattern:
                        '^(?!(?:notificationId|deliveryId|aps|from|message_type|collapse_key)$)(?!google\\.|gcm\\.).+$',
                    },
                  },
                },
                anyOf: [
                  { required: ['alert'], properties: { alert: {} } },
                  {
                    required: ['data'],
                    properties: { data: { type: 'object', minProperties: 1 } },
                  },
                ],
              },
              expiresAt: {
                type: 'string',
                format: 'date-time',
                description:
                  'Absolute expiry, at least one second and at most 28 days from new acceptance.',
              },
              overrides: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  apns: {
                    oneOf: [
                      {
                        type: 'object',
                        additionalProperties: false,
                        required: ['pushType'],
                        properties: {
                          pushType: { const: 'alert' },
                          priority: { type: 'integer', enum: [5, 10], default: 10 },
                          collapseId: {
                            type: 'string',
                            minLength: 1,
                            description: 'At most 64 UTF-8 bytes.',
                          },
                          sound: { type: 'string', minLength: 1 },
                          badge: { type: 'integer', minimum: 0, maximum: 2147483647 },
                        },
                      },
                      {
                        type: 'object',
                        additionalProperties: false,
                        required: ['pushType'],
                        properties: {
                          pushType: { const: 'background' },
                          priority: { type: 'integer', const: 5, default: 5 },
                          collapseId: {
                            type: 'string',
                            minLength: 1,
                            description: 'At most 64 UTF-8 bytes.',
                          },
                        },
                      },
                    ],
                  },
                  fcm: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      priority: { type: 'string', enum: ['NORMAL', 'HIGH'], default: 'NORMAL' },
                      collapseKey: { type: 'string', minLength: 1, maxLength: 64 },
                    },
                  },
                  webPush: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      urgency: {
                        type: 'string',
                        enum: ['very-low', 'low', 'normal', 'high'],
                        default: 'normal',
                      },
                      topic: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,32}$' },
                    },
                  },
                },
              },
            },
            allOf: [
              {
                if: {
                  required: ['overrides'],
                  properties: {
                    overrides: {
                      type: 'object',
                      required: ['apns'],
                      properties: {
                        apns: {
                          type: 'object',
                          required: ['pushType'],
                          properties: { pushType: { const: 'alert' } },
                        },
                      },
                    },
                  },
                },
                then: {
                  properties: {
                    content: { type: 'object', required: ['alert'], properties: { alert: {} } },
                  },
                },
              },
              {
                if: {
                  required: ['overrides'],
                  properties: {
                    overrides: {
                      type: 'object',
                      required: ['apns'],
                      properties: {
                        apns: {
                          type: 'object',
                          required: ['pushType'],
                          properties: { pushType: { const: 'background' } },
                        },
                      },
                    },
                  },
                },
                then: {
                  properties: {
                    content: {
                      type: 'object',
                      not: { required: ['alert'], properties: { alert: {} } },
                    },
                  },
                },
              },
            ],
          },
          NotificationAcceptance: {
            type: 'object',
            additionalProperties: false,
            required: ['notificationId', 'acceptedAt', 'deliveryCount'],
            properties: {
              notificationId: { type: 'string', format: 'uuid' },
              acceptedAt: { type: 'string', format: 'date-time' },
              deliveryCount: { type: 'integer', minimum: 1, maximum: 1000 },
            },
          },
        },
      },
    },
    // oxlint-enable unicorn/no-thenable
    responses: {
      '202': {
        description:
          'Durably queued acceptance or identical replay; provider delivery is asynchronous.',
        headers: { Location: { schema: { type: 'string' } } },
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/NotificationAcceptance' } },
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
      '409': {
        description: 'Idempotency fingerprint conflict or suspended scope',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '413': {
        description: 'Body exceeds 64 KiB',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '415': {
        description: 'JSON content type required',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '422': {
        description: 'Invalid request, key, expiry, targets, or provider payload size',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '429': {
        description: 'Admission limit exceeded',
        headers: { 'Retry-After': { schema: { type: 'integer', minimum: 1 } } },
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '503': {
        description: 'Acceptance unavailable; no partial acceptance commits',
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
  const key = v.safeParse(idempotencyKeySchema, event.req.headers.get('idempotency-key'));
  if (!key.success) {
    return problemResponse(422, 'NOTIFICATION_IDEMPOTENCY_KEY_INVALID', requestId);
  }
  const input = await readNotificationInput(event);
  if (input instanceof Response) {
    return input;
  }
  const scope = { kind: 'environment', ...path.output } as const;
  return withAuthorizedRequest(event, 'notification:send', scope, async (transaction) => {
    const result = await submitNotification(
      transaction,
      mailQueue,
      scope,
      event.context.principal?.kind === 'service-key' ? event.context.principal.keyId : null,
      await credentialKeyring(),
      key.output,
      input,
      requestId,
    );
    if (!result.ok) {
      if ('problem' in result) {
        return problemResponse(result.problem.status, result.problem.code, requestId);
      }
      const response = problemResponse(result.status, result.code, requestId);
      if (result.status === 429) {
        response.headers.set('retry-after', String(result.retryAfter));
      }
      return response;
    }
    return Response.json(result.value, {
      status: 202,
      headers: { location: `${event.url.pathname}/${result.value.notificationId}` },
    });
  });
});
