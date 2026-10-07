import { environmentPathSchema, issueServiceKey } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { auth } from '~/utils/auth.ts';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';
import { serviceKeyActor, readServiceKeyInput } from '~/utils/service-keys.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'issueServiceKey',
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
        description: 'issueServiceKey result',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/IssuedServiceKey',
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
            $ref: '#/components/schemas/ServiceKeyInput',
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          ServiceKey: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'organizationId',
              'projectId',
              'environmentId',
              'name',
              'actions',
              'enabled',
              'expiresAt',
              'createdAt',
              'rotatedAt',
            ],
            properties: {
              id: {
                type: 'string',
                format: 'uuid',
              },
              organizationId: {
                type: 'string',
                format: 'uuid',
              },
              projectId: {
                type: 'string',
                format: 'uuid',
              },
              environmentId: {
                type: 'string',
                format: 'uuid',
              },
              name: {
                type: ['string', 'null'],
              },
              actions: {
                type: 'array',
                minItems: 1,
                maxItems: 9,
                uniqueItems: true,
                items: {
                  type: 'string',
                  enum: [
                    'recipient:read',
                    'recipient:write',
                    'endpoint:read',
                    'endpoint:write',
                    'notification:read',
                    'notification:send',
                    'notification:cancel',
                    'delivery:read',
                    'event:read',
                  ],
                },
              },
              enabled: {
                type: ['boolean', 'null'],
              },
              expiresAt: {
                type: ['string', 'null'],
                format: 'date-time',
              },
              createdAt: {
                type: 'string',
                format: 'date-time',
              },
              rotatedAt: {
                type: ['string', 'null'],
                format: 'date-time',
              },
            },
          },
          IssuedServiceKey: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'metadata'],
            properties: {
              key: {
                type: 'string',
              },
              metadata: {
                $ref: '#/components/schemas/ServiceKey',
              },
            },
          },
          ServiceKeyInput: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'actions', 'expiresIn'],
            properties: {
              name: {
                type: 'string',
                minLength: 1,
                maxLength: 100,
                pattern: '^(?=[\\s\\S]*\\S)[^\\u0000\\uD800-\\uDFFF]{1,100}$',
              },
              actions: {
                type: 'array',
                minItems: 1,
                maxItems: 9,
                uniqueItems: true,
                items: {
                  type: 'string',
                  enum: [
                    'recipient:read',
                    'recipient:write',
                    'endpoint:read',
                    'endpoint:write',
                    'notification:read',
                    'notification:send',
                    'notification:cancel',
                    'delivery:read',
                    'event:read',
                  ],
                },
              },
              expiresIn: {
                type: 'integer',
                minimum: 60,
                maximum: 31536000,
              },
            },
          },
          ServiceKeyRotation: {
            type: 'object',
            additionalProperties: false,
            required: ['expiresIn', 'overlapSeconds'],
            properties: {
              expiresIn: {
                type: 'integer',
                minimum: 60,
                maximum: 31536000,
              },
              overlapSeconds: {
                type: 'integer',
                minimum: 0,
                maximum: 86400,
              },
            },
          },
          RotatedServiceKey: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'metadata', 'previousKeyExpiresAt'],
            properties: {
              key: {
                type: 'string',
              },
              metadata: {
                $ref: '#/components/schemas/ServiceKey',
              },
              previousKeyExpiresAt: {
                type: 'string',
                format: 'date-time',
              },
            },
          },
          ServiceKeyPage: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor'],
            properties: {
              items: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/ServiceKey',
                },
              },
              nextCursor: {
                type: ['string', 'null'],
              },
            },
          },
          RevokedServiceKey: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'revoked'],
            properties: {
              id: {
                type: 'string',
                format: 'uuid',
              },
              revoked: {
                type: 'boolean',
                const: true,
              },
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
  const actor = serviceKeyActor(event);

  if (actor instanceof Response) {
    return actor;
  }

  const input = await readServiceKeyInput(event);

  if (input instanceof Response) {
    return input;
  }

  return withAuthorizedRequest(event, 'service-key:manage', scope, async (transaction) => {
    const result = await issueServiceKey(transaction, scope, actor, input, auth.issueServiceKey);

    return Response.json(result, { status: 201 });
  });
});
