import { environmentPathSchema, listServiceKeys, resourcePageSchema } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import { getQuery } from 'nitro/h3';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';
import { serviceKeyResponse } from '~/utils/service-keys.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'listServiceKeys',
    tags: ['service-keys'],
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
          minLength: 1,
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
        description: 'Resource not found',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '409': {
        description: 'Key lifecycle conflict',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
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
      '429': {
        description: 'Rate limit exceeded',
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
        description: 'listServiceKeys result',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ServiceKeyPage',
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
  const query = v.safeParse(resourcePageSchema, getQuery(event));

  if (!query.success) {
    return problemResponse(422, 'RESOURCE_QUERY_INVALID', event.context.requestId ?? 'unavailable');
  }

  return withAuthorizedRequest(event, 'service-key:read', scope, async (transaction) => {
    const result = await listServiceKeys(
      transaction,
      scope,
      query.output.limit,
      query.output.cursor,
    );

    return serviceKeyResponse(event, result);
  });
});
