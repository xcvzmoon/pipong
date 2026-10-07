import { environmentPathSchema } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'deleteEnvironment',
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
      {
        in: 'path',
        name: 'environmentId',
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
        description: 'Scoped name conflict, suspended parent, or deletion gated',
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
    },
    description: 'Deletion is gated until bounded erasure is implemented. No records are removed.',
  },
});

export default defineHandler(async (event) => {
  const path = v.safeParse(environmentPathSchema, event.context.params);

  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', event.context.requestId ?? 'unavailable');
  }

  const { organizationId, projectId, environmentId } = path.output;

  return withAuthorizedRequest(
    event,
    'environment:manage',
    { kind: 'environment', organizationId, projectId, environmentId },
    (_transaction) => {
      return Promise.resolve(
        problemResponse(409, 'RESOURCE_DELETION_GATED', event.context.requestId ?? 'unavailable'),
      );
    },
  );
});
