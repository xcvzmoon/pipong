import { organizationPathSchema, listProjects, resourcePageSchema } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';
import { resourceResponse } from '~/utils/resources.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'listProjects',
    tags: ['projects'],
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
      '200': {
        description: 'Project list result',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ProjectPage',
            },
          },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const path = v.safeParse(organizationPathSchema, event.context.params);

  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', event.context.requestId ?? 'unavailable');
  }

  const { organizationId } = path.output;
  const input = v.safeParse(resourcePageSchema, Object.fromEntries(event.url.searchParams));

  if (
    !input.success ||
    new Set(event.url.searchParams.keys()).size !== [...event.url.searchParams].length
  ) {
    return problemResponse(422, 'RESOURCE_INPUT_INVALID', event.context.requestId ?? 'unavailable');
  }

  return withAuthorizedRequest(
    event,
    'project:read',
    { kind: 'organization', organizationId },
    async (transaction) => {
      const result = await listProjects(
        transaction,
        { kind: 'organization', organizationId },
        input.output.limit,
        input.output.cursor,
      );
      return resourceResponse(event, result);
    },
  );
});
