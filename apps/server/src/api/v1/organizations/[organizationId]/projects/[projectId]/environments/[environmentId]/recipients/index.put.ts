import { upsertRecipient, environmentPathSchema } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';
import { readRecipientInput } from '~/utils/recipients.ts';
import { resourceResponse } from '~/utils/resources.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'upsertRecipient',
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
              $ref: '#/components/schemas/Recipient',
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
            $ref: '#/components/schemas/RecipientInput',
          },
        },
      },
    },
    $global: {
      components: {
        securitySchemes: {
          serviceKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        },
        schemas: {
          Recipient: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'organizationId',
              'projectId',
              'environmentId',
              'externalId',
              'createdAt',
              'updatedAt',
              'deletedAt',
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
              externalId: {
                type: 'string',
              },
              createdAt: {
                type: 'string',
                format: 'date-time',
              },
              updatedAt: {
                type: 'string',
                format: 'date-time',
              },
              deletedAt: {
                type: 'null',
              },
            },
          },
          RecipientInput: {
            type: 'object',
            additionalProperties: false,
            required: ['externalId'],
            properties: {
              externalId: {
                type: 'string',
                pattern: '^[^\\uD800-\\uDFFF\\u0000-\\u001F\\u007F-\\u009F]{1,200}$',
                allOf: [
                  {
                    pattern: '\\S',
                  },
                ],
              },
            },
          },
          RecipientPage: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor'],
            properties: {
              items: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/Recipient',
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
  const path = v.safeParse(environmentPathSchema, event.context.params);

  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', event.context.requestId ?? 'unavailable');
  }

  const { organizationId, projectId, environmentId } = path.output;
  const scope = { kind: 'environment', organizationId, projectId, environmentId } as const;
  const input = await readRecipientInput(event);

  if (input instanceof Response) {
    return input;
  }

  return withAuthorizedRequest(event, 'recipient:write', scope, async (transaction) => {
    const result = await upsertRecipient(transaction, scope, input.externalId);
    return resourceResponse(event, result);
  });
});
