import { environmentPathSchema, redriveDelivery } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { mailQueue } from '~/utils/auth.ts';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';
import { readRedriveInput } from '~/utils/recovery.ts';

const pathSchema = v.strictObject({
  ...environmentPathSchema.entries,
  deliveryId: v.pipe(v.string(), v.uuid()),
});

defineRouteMeta({
  openAPI: {
    operationId: 'redriveDelivery',
    tags: ['deliveries'],
    security: [
      {
        sessionCookie: [],
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
        in: 'path',
        name: 'deliveryId',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
        },
      },
    ],
    responses: {
      '202': {
        description: 'Fresh delivery queued',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['notificationId', 'deliveryId', 'sourceDeliveryId'],
              properties: {
                notificationId: {
                  type: 'string',
                  format: 'uuid',
                },
                deliveryId: {
                  type: 'string',
                  format: 'uuid',
                },
                sourceDeliveryId: {
                  type: 'string',
                  format: 'uuid',
                },
              },
            },
          },
        },
      },
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
        description: 'Insufficient authority or recent MFA required',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '404': {
        description: 'Scoped resource not found',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '409': {
        description: 'Recovery conflicts with resource state',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '422': {
        description: 'Invalid request',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '503': {
        description: 'Recovery unavailable',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '413': {
        description: 'Body exceeds 4 KiB',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '415': {
        description: 'JSON content type required',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '429': {
        description: 'Admission limit exceeded',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
        headers: {
          'Retry-After': {
            schema: {
              type: 'integer',
              minimum: 1,
            },
          },
        },
      },
    },
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['expiresAt', 'reason'],
            properties: {
              expiresAt: {
                type: 'string',
                format: 'date-time',
                description: 'Fresh expiry, between one second and 28 days from redrive.',
              },
              reason: {
                type: 'string',
                minLength: 1,
                maxLength: 500,
              },
            },
          },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const requestId = event.context.requestId ?? 'unavailable';
  const path = v.safeParse(pathSchema, event.context.params);
  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', requestId);
  }
  const input = await readRedriveInput(event);
  if (input instanceof Response) {
    return input;
  }
  const { organizationId, projectId, environmentId, deliveryId } = path.output;
  const scope = { kind: 'environment', organizationId, projectId, environmentId } as const;
  return withAuthorizedRequest(event, 'delivery:redrive', scope, async (transaction) => {
    const principal = event.context.principal;
    if (principal?.kind !== 'human') {
      return problemResponse(403, 'AUTH_PERMISSION_DENIED', requestId);
    }
    const result = await redriveDelivery(
      transaction,
      mailQueue,
      scope,
      deliveryId,
      new Date(input.expiresAt),
      principal.userId,
      input.reason,
    );
    if (!result.ok) {
      const response = problemResponse(result.status, result.code, requestId);
      if (result.retryAfter !== undefined) {
        response.headers.set('retry-after', String(result.retryAfter));
      }
      return response;
    }
    return Response.json(result.value, { status: 202 });
  });
});
