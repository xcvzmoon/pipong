import { serviceKeyPathSchema, rotateServiceKey } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { auth } from '~/utils/auth.ts';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';
import {
  serviceKeyActor,
  readServiceKeyRotation,
  serviceKeyResponse,
} from '~/utils/service-keys.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'rotateServiceKey',
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
        in: 'path',
        name: 'keyId',
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
      '201': {
        description: 'rotateServiceKey result',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/RotatedServiceKey',
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
            $ref: '#/components/schemas/ServiceKeyRotation',
          },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const path = v.safeParse(serviceKeyPathSchema, event.context.params);

  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', event.context.requestId ?? 'unavailable');
  }

  const { organizationId, projectId, environmentId, keyId } = path.output;
  const scope = { kind: 'environment', organizationId, projectId, environmentId } as const;
  const actor = serviceKeyActor(event);

  if (actor instanceof Response) {
    return actor;
  }

  const input = await readServiceKeyRotation(event);

  if (input instanceof Response) {
    return input;
  }

  return withAuthorizedRequest(event, 'service-key:manage', scope, async (transaction) => {
    const result = await rotateServiceKey(
      transaction,
      scope,
      actor,
      keyId,
      input,
      auth.issueServiceKey,
    );

    return serviceKeyResponse(event, result, 201);
  });
});
