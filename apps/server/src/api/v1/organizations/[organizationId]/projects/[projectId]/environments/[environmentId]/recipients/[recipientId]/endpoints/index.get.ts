import { listEndpoints, recipientPathSchema, resourcePageSchema } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import { getQuery } from 'nitro/h3';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';
import { resourceResponse } from '~/utils/resources.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'listEndpoints',
    tags: ['endpoints'],
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
        name: 'recipientId',
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
        description: 'Recipient, endpoint, credential, or scope not found',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '409': {
        description: 'Suspended scope, binding conflict, or stale generation',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '422': {
        description: 'Invalid input, destination, or cursor',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '503': {
        description: 'Persistence, encryption, or DNS unavailable',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '200': {
        description: 'Redacted endpoint metadata',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/EndpointPage',
            },
          },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const path = v.safeParse(recipientPathSchema, event.context.params);
  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', event.context.requestId ?? 'unavailable');
  }
  const { organizationId, projectId, environmentId, recipientId } = path.output;
  const scope = { kind: 'environment', organizationId, projectId, environmentId } as const;
  const query = v.safeParse(resourcePageSchema, getQuery(event));
  if (!query.success) {
    return problemResponse(422, 'RESOURCE_INPUT_INVALID', event.context.requestId ?? 'unavailable');
  }
  return withAuthorizedRequest(event, 'endpoint:read', scope, async (transaction) => {
    const result = await listEndpoints(
      transaction,
      scope,
      recipientId,
      query.output.limit,
      query.output.cursor,
    );
    return resourceResponse(event, result);
  });
});
