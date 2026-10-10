import { deleteRecipient, recipientPathSchema } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';
import { resourceResponse } from '~/utils/resources.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'deleteRecipient',
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
        in: 'path',
        name: 'recipientId',
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
      '204': {
        description: 'Recipient deleted',
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

  return withAuthorizedRequest(event, 'recipient:write', scope, async (transaction) => {
    const principal = event.context.principal;
    if (!principal) {
      return problemResponse(
        401,
        'AUTH_CREDENTIALS_INVALID',
        event.context.requestId ?? 'unavailable',
      );
    }
    const result = await deleteRecipient(
      transaction,
      scope,
      recipientId,
      principal.kind === 'human' ? principal.userId : principal.keyId,
    );
    return result.ok ? new Response(null, { status: 204 }) : resourceResponse(event, result);
  });
});
