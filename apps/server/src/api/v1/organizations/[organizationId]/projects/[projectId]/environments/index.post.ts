import { projectPathSchema, createEnvironment } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';
import { readResourceInput, resourceResponse } from '~/utils/resources.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'createEnvironment',
    tags: ['environments'],
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
        description: 'Scoped name conflict or suspended parent',
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
      '201': {
        description: 'Environment create result',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Environment',
            },
          },
        },
      },
      '413': {
        description: 'Body exceeds 4096 bytes',
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
    },
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/ResourceInput',
          },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const path = v.safeParse(projectPathSchema, event.context.params);

  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', event.context.requestId ?? 'unavailable');
  }

  const { organizationId, projectId } = path.output;
  const input = await readResourceInput(event);

  if (input instanceof Response) {
    return input;
  }

  return withAuthorizedRequest(
    event,
    'environment:manage',
    { kind: 'project', organizationId, projectId },
    async (transaction) => {
      const result = await createEnvironment(
        transaction,
        { kind: 'project', organizationId, projectId },
        input.name,
      );
      const response = resourceResponse(event, result, 201);

      if (result.ok) {
        response.headers.set(
          'location',
          `${event.url.pathname.replace(/\/$/, '')}/${result.value.id}`,
        );
      }

      return response;
    },
  );
});
