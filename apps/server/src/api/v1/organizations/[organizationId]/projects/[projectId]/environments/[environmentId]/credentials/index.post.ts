import { createCredentialVersion, environmentPathSchema } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { credentialKeyring, readCredentialInput } from '~/utils/credentials.ts';
import { problemResponse } from '~/utils/problem.ts';
import { resourceResponse } from '~/utils/resources.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'createCredentialVersion',
    tags: ['credentials'],
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
        description: 'Authentication required',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '403': {
        description: 'Insufficient authority or recent MFA',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '404': {
        description: 'Version or scope not found',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '409': {
        description: 'Retired or inactive credential',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '422': {
        description: 'Invalid input',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '503': {
        description: 'Database or encryption unavailable',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '200': {
        description: 'Public credential metadata',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/CredentialVersion',
            },
          },
        },
      },
      '413': {
        description: 'Body exceeds 32768 bytes',
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
            $ref: '#/components/schemas/CredentialInput',
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          CredentialVersion: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'organizationId',
              'projectId',
              'environmentId',
              'provider',
              'appId',
              'publicKey',
              'state',
              'createdAt',
              'retiredAt',
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
              provider: {
                type: 'string',
                enum: ['apns', 'fcm', 'web-push'],
              },
              appId: {
                type: 'string',
              },
              publicKey: {
                type: ['string', 'null'],
              },
              state: {
                type: 'string',
                enum: ['inactive', 'active', 'retired'],
              },
              createdAt: {
                type: 'string',
                format: 'date-time',
              },
              retiredAt: {
                type: ['string', 'null'],
                format: 'date-time',
              },
            },
          },
          CredentialInput: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['provider', 'appId', 'secret'],
                properties: {
                  provider: {
                    const: 'apns',
                  },
                  appId: {
                    type: 'string',
                    pattern: '^[A-Za-z0-9._-]{1,200}$',
                  },
                  secret: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['teamId', 'keyId', 'environment', 'privateKey'],
                    properties: {
                      teamId: {
                        type: 'string',
                        pattern: '^[A-Z0-9]{10}$',
                      },
                      keyId: {
                        type: 'string',
                        pattern: '^[A-Z0-9]{10}$',
                      },
                      environment: {
                        type: 'string',
                        enum: ['production', 'sandbox'],
                      },
                      privateKey: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 16384,
                      },
                    },
                  },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['provider', 'appId', 'secret'],
                properties: {
                  provider: {
                    const: 'fcm',
                  },
                  appId: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9-]{4,28}[a-z0-9]$',
                  },
                  secret: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['projectId', 'clientEmail', 'privateKey'],
                    properties: {
                      projectId: {
                        type: 'string',
                        pattern: '^[a-z][a-z0-9-]{4,28}[a-z0-9]$',
                      },
                      clientEmail: {
                        type: 'string',
                        format: 'email',
                        maxLength: 254,
                      },
                      privateKey: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 16384,
                      },
                    },
                  },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['provider', 'appId', 'secret'],
                properties: {
                  provider: {
                    const: 'web-push',
                  },
                  appId: {
                    type: 'string',
                    pattern: '^[A-Za-z0-9._-]{1,200}$',
                  },
                  secret: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['privateKey'],
                    properties: {
                      privateKey: {
                        type: 'string',
                        pattern: '^[A-Za-z0-9_-]{43}$',
                      },
                    },
                  },
                },
              },
            ],
          },
          CredentialPage: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor'],
            properties: {
              items: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/CredentialVersion',
                },
              },
              nextCursor: {
                type: ['string', 'null'],
              },
            },
          },
          VapidPublicKey: {
            type: 'object',
            additionalProperties: false,
            required: ['credentialId', 'publicKey'],
            properties: {
              credentialId: {
                type: 'string',
                format: 'uuid',
              },
              publicKey: {
                type: 'string',
                pattern: '^[A-Za-z0-9_-]{87}$',
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
  const input = await readCredentialInput(event);

  if (input instanceof Response) {
    return input;
  }

  return withAuthorizedRequest(event, 'credential:manage', scope, async (transaction) => {
    const result = await createCredentialVersion(
      transaction,
      scope,
      await credentialKeyring(),
      input,
    );

    return resourceResponse(event, result);
  });
});
