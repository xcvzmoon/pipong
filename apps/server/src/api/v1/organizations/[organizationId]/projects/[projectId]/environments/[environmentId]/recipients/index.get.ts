import { listRecipients, environmentPathSchema, resourcePageSchema } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';
import { resourceResponse } from '~/utils/resources.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'listRecipients',
    tags: ['recipients'],
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
        description: 'Recipient or scope not found',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '409': {
        description: 'Suspended scope or deleted identity',
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
        description: 'Active recipient result',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/RecipientPage',
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
  const input = v.safeParse(resourcePageSchema, Object.fromEntries(event.url.searchParams));

  if (
    !input.success ||
    new Set(event.url.searchParams.keys()).size !== [...event.url.searchParams].length
  ) {
    return problemResponse(422, 'RESOURCE_INPUT_INVALID', event.context.requestId ?? 'unavailable');
  }

  return withAuthorizedRequest(event, 'recipient:read', scope, async (transaction) => {
    const result = await listRecipients(
      transaction,
      scope,
      input.output.limit,
      input.output.cursor,
    );

    return resourceResponse(event, result);
  });
});
