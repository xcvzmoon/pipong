import { registerEndpoint, recipientPathSchema, loadEgressPolicy } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { credentialKeyring } from '~/utils/credentials.ts';
import { readEndpointInput } from '~/utils/endpoints.ts';
import { problemResponse } from '~/utils/problem.ts';
import { resourceResponse } from '~/utils/resources.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'registerEndpoint',
    tags: ['endpoints'],
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
        description: 'Recipient, endpoint, credential, or scope not found',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '409': {
        description: 'Suspended scope, binding conflict, or stale generation',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '422': {
        description: 'Invalid input, destination, or cursor',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '503': {
        description: 'Persistence, encryption, or DNS unavailable',
        content: {
          'application/problem+json': {
            schema: {
              $ref: '#/components/schemas/ResourceProblem',
            },
          },
        },
      },
      '200': {
        description: 'Redacted endpoint metadata',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Endpoint',
            },
          },
        },
      },
      '413': {
        description: 'Body exceeds 16384 bytes',
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
            $ref: '#/components/schemas/EndpointInput',
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          Endpoint: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'organizationId',
              'projectId',
              'environmentId',
              'recipientId',
              'credentialId',
              'installationId',
              'appId',
              'provider',
              'generation',
              'state',
              'registeredAt',
              'createdAt',
              'disabledAt',
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
              recipientId: {
                type: 'string',
                format: 'uuid',
              },
              credentialId: {
                type: 'string',
                format: 'uuid',
              },
              installationId: {
                type: 'string',
                pattern: '^[A-Za-z0-9._-]{1,200}$',
              },
              appId: {
                type: 'string',
                pattern: '^[A-Za-z0-9._-]{1,200}$',
              },
              provider: {
                type: 'string',
                enum: ['apns', 'fcm', 'web-push'],
              },
              generation: {
                type: 'integer',
                minimum: 1,
                maximum: 2147483647,
              },
              state: {
                type: 'string',
                enum: ['active', 'disabled'],
              },
              registeredAt: {
                type: 'string',
                format: 'date-time',
              },
              createdAt: {
                type: 'string',
                format: 'date-time',
              },
              disabledAt: {
                type: ['string', 'null'],
                format: 'date-time',
              },
            },
          },
          EndpointInput: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['installationId', 'credentialId', 'appId', 'provider', 'target'],
                properties: {
                  installationId: {
                    type: 'string',
                    pattern: '^[A-Za-z0-9._-]{1,200}$',
                  },
                  credentialId: {
                    type: 'string',
                    format: 'uuid',
                  },
                  appId: {
                    type: 'string',
                    pattern: '^[A-Za-z0-9._-]{1,200}$',
                  },
                  provider: {
                    const: 'apns',
                  },
                  target: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['token', 'environment'],
                    properties: {
                      token: {
                        type: 'string',
                        pattern: '^(?:[a-fA-F0-9]{2}){1,512}$',
                      },
                      environment: {
                        type: 'string',
                        enum: ['production', 'sandbox'],
                      },
                    },
                  },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['installationId', 'credentialId', 'appId', 'provider', 'target'],
                properties: {
                  installationId: {
                    type: 'string',
                    pattern: '^[A-Za-z0-9._-]{1,200}$',
                  },
                  credentialId: {
                    type: 'string',
                    format: 'uuid',
                  },
                  appId: {
                    type: 'string',
                    pattern: '^[A-Za-z0-9._-]{1,200}$',
                  },
                  provider: {
                    const: 'fcm',
                  },
                  target: {
                    oneOf: [
                      {
                        type: 'object',
                        additionalProperties: false,
                        required: ['kind', 'value'],
                        properties: {
                          kind: {
                            const: 'fid',
                          },
                          value: {
                            type: 'string',
                            pattern: '^[cdef][A-Za-z0-9_-]{21}$',
                          },
                        },
                      },
                      {
                        type: 'object',
                        additionalProperties: false,
                        required: ['kind', 'value'],
                        properties: {
                          kind: {
                            const: 'registration-token',
                          },
                          value: {
                            type: 'string',
                            pattern: '^[A-Za-z0-9_:.-]{1,4096}$',
                          },
                        },
                      },
                    ],
                  },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['installationId', 'credentialId', 'appId', 'provider', 'target'],
                properties: {
                  installationId: {
                    type: 'string',
                    pattern: '^[A-Za-z0-9._-]{1,200}$',
                  },
                  credentialId: {
                    type: 'string',
                    format: 'uuid',
                  },
                  appId: {
                    type: 'string',
                    pattern: '^[A-Za-z0-9._-]{1,200}$',
                  },
                  provider: {
                    const: 'web-push',
                  },
                  target: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['endpoint', 'p256dh', 'auth', 'applicationServerKey'],
                    properties: {
                      endpoint: {
                        type: 'string',
                        format: 'uri',
                        maxLength: 4096,
                      },
                      p256dh: {
                        type: 'string',
                        pattern: '^[A-Za-z0-9_-]{87}$',
                      },
                      auth: {
                        type: 'string',
                        pattern: '^[A-Za-z0-9_-]{22}$',
                      },
                      expirationTime: {
                        type: ['integer', 'null'],
                        minimum: 0,
                        maximum: 8640000000000000,
                      },
                      applicationServerKey: {
                        type: 'string',
                        pattern: '^[A-Za-z0-9_-]{87}$',
                      },
                    },
                  },
                },
              },
            ],
          },
          EndpointDisableInput: {
            type: 'object',
            additionalProperties: false,
            required: ['generation'],
            properties: {
              generation: {
                type: 'integer',
                minimum: 1,
                maximum: 2147483647,
              },
            },
          },
          EndpointPage: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor'],
            properties: {
              items: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/Endpoint',
                },
              },
              nextCursor: {
                type: ['string', 'null'],
              },
            },
          },
        },
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
  const input = await readEndpointInput(event);
  if (input instanceof Response) {
    return input;
  }
  return withAuthorizedRequest(event, 'endpoint:write', scope, async (transaction) => {
    const result = await registerEndpoint(
      transaction,
      scope,
      recipientId,
      await credentialKeyring(),
      await loadEgressPolicy(process.env.WEB_PUSH_EGRESS_POLICY_REF),
      input,
    );
    return resourceResponse(event, result);
  });
});
