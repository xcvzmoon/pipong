import { environmentPathSchema, cancelNotification } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';

const pathSchema = v.strictObject({
  ...environmentPathSchema.entries,
  notificationId: v.pipe(v.string(), v.uuid()),
});

defineRouteMeta({
  openAPI: {
    operationId: 'cancelNotification',
    tags: ['notifications'],
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
        in: 'path',
        name: 'notificationId',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
        },
      },
    ],
    responses: {
      '200': {
        description: 'Notification canceled',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['notificationId', 'canceledCount'],
              properties: {
                notificationId: {
                  type: 'string',
                  format: 'uuid',
                },
                canceledCount: {
                  type: 'integer',
                  minimum: 0,
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
    },
  },
});

export default defineHandler(async (event) => {
  const requestId = event.context.requestId ?? 'unavailable';
  const path = v.safeParse(pathSchema, event.context.params);
  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', requestId);
  }
  const { organizationId, projectId, environmentId, notificationId } = path.output;
  const scope = { kind: 'environment', organizationId, projectId, environmentId } as const;
  return withAuthorizedRequest(event, 'notification:cancel', scope, async (transaction) => {
    const result = await cancelNotification(transaction, scope, notificationId);
    if (!result.ok) {
      const response = problemResponse(result.status, result.code, requestId);
      if (result.retryAfter !== undefined) {
        response.headers.set('retry-after', String(result.retryAfter));
      }
      return response;
    }
    return Response.json(result.value, { status: 200 });
  });
});
