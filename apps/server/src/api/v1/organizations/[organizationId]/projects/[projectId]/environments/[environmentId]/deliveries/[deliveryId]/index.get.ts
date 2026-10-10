import { readDeliveryStatus } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';

const pathSchema = v.strictObject({
  organizationId: v.pipe(v.string(), v.uuid()),
  projectId: v.pipe(v.string(), v.uuid()),
  environmentId: v.pipe(v.string(), v.uuid()),
  deliveryId: v.pipe(v.string(), v.uuid()),
});

defineRouteMeta({
  openAPI: {
    operationId: 'readDeliveryOutcome',
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
        name: 'deliveryId',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
    ],
    responses: {
      '200': {
        description: 'Delivery outcome and redacted attempt metadata',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/DeliveryOutcome' } },
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
        description: 'Delivery not found',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '422': {
        description: 'Invalid path',
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
          DeliveryAttemptStatus: {
            type: 'object',
            additionalProperties: false,
            required: ['generation', 'retryCount', 'startedAt', 'finishedAt', 'outcome'],
            properties: {
              generation: { type: 'integer', minimum: 1 },
              retryCount: { type: 'integer', minimum: 0 },
              startedAt: { type: 'string', format: 'date-time' },
              finishedAt: { type: ['string', 'null'], format: 'date-time' },
              outcome: {
                type: ['string', 'null'],
                enum: ['accepted', 'permanent', 'transient', 'ambiguous', null],
              },
            },
          },
          DeliveryOutcome: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'provider', 'state', 'attempts'],
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
              attempts: {
                type: 'array',
                items: { $ref: '#/components/schemas/DeliveryAttemptStatus' },
              },
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
  const { deliveryId, ...scopePath } = path.output;
  const scope = { kind: 'environment', ...scopePath } as const;
  return withAuthorizedRequest(event, 'delivery:read', scope, async (transaction) => {
    const result = await readDeliveryStatus(transaction, scope, deliveryId);
    if (!result.ok) {
      return problemResponse(result.status, result.code, event.context.requestId ?? 'unavailable');
    }
    return Response.json(result.value);
  });
});
