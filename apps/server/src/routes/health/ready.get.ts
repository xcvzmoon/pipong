import { readRuntimeHealth } from '@pipong/service';
import { defineHandler, defineRouteMeta } from 'nitro';
import { database } from '../../utils/auth.ts';
import { credentialKeyring } from '../../utils/credentials.ts';
import { protectDiagnostics } from '../../utils/telemetry.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'readReadiness',
    tags: ['diagnostics'],
    security: [{ diagnosticsToken: [] }],
    $global: {
      components: {
        schemas: {
          RuntimeHealth: {
            type: 'object',
            additionalProperties: false,
            required: ['status', 'database', 'queues', 'consumers', 'configuration'],
            properties: {
              status: { enum: ['ready', 'unready'] },
              database: { type: 'boolean' },
              queues: { type: 'boolean' },
              consumers: { type: 'boolean' },
              configuration: { type: 'boolean' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Database, queues, configuration, and consumers are ready',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/RuntimeHealth' } } },
      },
      '503': {
        description: 'At least one readiness dependency is unavailable',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/RuntimeHealth' } } },
      },
      '404': { description: 'Diagnostics disabled or operator token rejected' },
    },
  },
});

export default defineHandler({
  middleware: [protectDiagnostics],
  handler: async () => {
    const configuration = await credentialKeyring().then(
      () => true,
      () => false,
    );
    const health = await readRuntimeHealth(database, configuration);
    return Response.json(health, {
      status: health.status === 'ready' ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    });
  },
});
