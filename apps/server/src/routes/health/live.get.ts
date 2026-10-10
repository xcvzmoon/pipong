import { defineHandler, defineRouteMeta } from 'nitro';
import { protectDiagnostics } from '../../utils/telemetry.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'readLiveness',
    tags: ['diagnostics'],
    security: [{ diagnosticsToken: [] }],
    $global: {
      components: { securitySchemes: { diagnosticsToken: { type: 'http', scheme: 'bearer' } } },
    },
    responses: {
      '200': {
        description: 'Initialized API process answers HTTP',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['status'],
              properties: { status: { const: 'alive' } },
            },
          },
        },
      },
      '404': { description: 'Diagnostics disabled or operator token rejected' },
    },
  },
});

export default defineHandler({
  middleware: [protectDiagnostics],
  handler: () => ({ status: 'alive' }),
});
