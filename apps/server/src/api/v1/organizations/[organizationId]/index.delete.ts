import { eraseScope, organizationPathSchema } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'deleteOrganization',
    tags: ['organizations'],
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
    ],
    responses: {
      '202': {
        description: 'Erasure accepted',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['erasureId', 'requestedAt', 'inFlightUntil'],
              additionalProperties: false,
              properties: {
                erasureId: { type: 'string', format: 'uuid' },
                requestedAt: { type: 'string', format: 'date-time' },
                inFlightUntil: { type: 'string', format: 'date-time' },
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
        description: 'Scope suspended',
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
    description:
      'Tombstones the scope and requests bounded data erasure. Reserved sends may finish within two minutes.',
  },
});

export default defineHandler(async (event) => {
  const path = v.safeParse(organizationPathSchema, event.context.params);

  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', event.context.requestId ?? 'unavailable');
  }

  const { organizationId } = path.output;

  return withAuthorizedRequest(
    event,
    'organization:manage',
    { kind: 'organization', organizationId },
    async (transaction) => {
      const principal = event.context.principal;
      if (principal?.kind !== 'human') {
        return problemResponse(
          403,
          'AUTH_PERMISSION_DENIED',
          event.context.requestId ?? 'unavailable',
        );
      }
      const receipt = await eraseScope(
        transaction,
        { kind: 'organization', organizationId },
        principal.userId,
      );
      return Response.json(receipt, { status: 202 });
    },
  );
});
