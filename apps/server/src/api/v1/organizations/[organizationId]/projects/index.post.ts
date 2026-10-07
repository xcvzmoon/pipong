import { organizationPathSchema, createProject } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';
import { readResourceInput, resourceResponse } from '~/utils/resources.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'createProject',
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
      '201': {
        description: 'Project create result',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Project',
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
            $ref: '#/components/schemas/ResourceInput',
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          Project: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'organizationId',
              'name',
              'createdAt',
              'updatedAt',
              'deletedAt',
              'suspendedAt',
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
              name: {
                type: 'string',
                minLength: 1,
                maxLength: 100,
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
                type: ['string', 'null'],
                format: 'date-time',
              },
              suspendedAt: {
                type: ['string', 'null'],
                format: 'date-time',
              },
            },
          },
          Environment: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'organizationId',
              'name',
              'createdAt',
              'updatedAt',
              'deletedAt',
              'suspendedAt',
              'projectId',
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
              name: {
                type: 'string',
                minLength: 1,
                maxLength: 100,
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
                type: ['string', 'null'],
                format: 'date-time',
              },
              suspendedAt: {
                type: ['string', 'null'],
                format: 'date-time',
              },
              projectId: {
                type: 'string',
                format: 'uuid',
              },
            },
          },
          ResourceProblem: {
            type: 'object',
            required: ['type', 'title', 'status', 'code', 'requestId'],
            properties: {
              type: {
                type: 'string',
              },
              title: {
                type: 'string',
              },
              status: {
                type: 'integer',
              },
              code: {
                type: 'string',
              },
              requestId: {
                type: 'string',
                format: 'uuid',
              },
            },
            additionalProperties: false,
          },
          ResourceInput: {
            type: 'object',
            required: ['name'],
            additionalProperties: false,
            properties: {
              name: {
                type: 'string',
                minLength: 1,
                maxLength: 100,
                pattern: '^(?![\\s\\S]*[\\u0000\\uD800-\\uDFFF])[\\s\\S]*\\S[\\s\\S]*$',
                description:
                  'One to 100 Unicode characters before trimming; nonblank, no NUL or unpaired surrogates. Stored trimmed and compared case-sensitively.',
              },
            },
          },
          ProjectPage: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor'],
            properties: {
              items: {
                type: 'array',
                maxItems: 100,
                items: {
                  $ref: '#/components/schemas/Project',
                },
              },
              nextCursor: {
                type: ['string', 'null'],
              },
            },
          },
          EnvironmentPage: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor'],
            properties: {
              items: {
                type: 'array',
                maxItems: 100,
                items: {
                  $ref: '#/components/schemas/Environment',
                },
              },
              nextCursor: {
                type: ['string', 'null'],
              },
            },
          },
        },
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: 'better-auth.session_token',
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
  const input = await readResourceInput(event);

  if (input instanceof Response) {
    return input;
  }

  return withAuthorizedRequest(
    event,
    'project:manage',
    { kind: 'organization', organizationId },
    async (transaction) => {
      const result = await createProject(
        transaction,
        { kind: 'organization', organizationId },
        input.name,
      );
      const response = resourceResponse(event, result, 201);

      if (result.ok) {
        response.headers.set(
          'location',
          `${event.url.pathname.replace(/\/$/, '')}/${result.value.id}`,
        );
      }

      return response;
    },
  );
});
