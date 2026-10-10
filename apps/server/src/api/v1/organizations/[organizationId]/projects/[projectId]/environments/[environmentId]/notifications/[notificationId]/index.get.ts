import { readNotificationSummary } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { problemResponse } from '~/utils/problem.ts';

const pathSchema = v.strictObject({
  organizationId: v.pipe(v.string(), v.uuid()),
  projectId: v.pipe(v.string(), v.uuid()),
  environmentId: v.pipe(v.string(), v.uuid()),
  notificationId: v.pipe(v.string(), v.uuid()),
});

defineRouteMeta({
  openAPI: {
    operationId: 'readNotificationSummary',
    tags: ['notifications'],
    security: [{ sessionCookie: [] }, { serviceKey: [] }],
    parameters: [
      {
        in: 'path',
        name: 'organizationId',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      { in: 'path', name: 'projectId', required: true, schema: { type: 'string', format: 'uuid' } },
      {
        in: 'path',
        name: 'environmentId',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      {
        in: 'path',
        name: 'notificationId',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
    ],
    responses: {
      '200': {
        description: 'Authoritative notification status summary',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/NotificationSummary' } },
        },
      },
      '401': {
        description: 'Invalid credentials',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '403': {
        description: 'Insufficient authority',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '404': {
        description: 'Notification not found',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '422': {
        description: 'Invalid path',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
      '503': {
        description: 'Persistence unavailable',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ResourceProblem' } },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const path = v.safeParse(pathSchema, event.context.params);
  if (!path.success) {
    return problemResponse(422, 'RESOURCE_PATH_INVALID', event.context.requestId ?? 'unavailable');
  }
  const { notificationId, ...scopePath } = path.output;
  const scope = { kind: 'environment', ...scopePath } as const;
  return withAuthorizedRequest(event, 'notification:read', scope, async (transaction) => {
    const result = await readNotificationSummary(transaction, scope, notificationId);
    if (!result.ok) {
      return problemResponse(result.status, result.code, event.context.requestId ?? 'unavailable');
    }
    return Response.json(result.value);
  });
});
