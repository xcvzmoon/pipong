import { readDatabaseDiagnostics } from '@pipong/database/telemetry';
import { defineHandler, defineRouteMeta } from 'nitro';
import { database } from '../utils/auth.ts';
import { eventStreams } from '../utils/event-stream.ts';
import { protectDiagnostics, telemetry } from '../utils/telemetry.ts';

defineRouteMeta({
  openAPI: {
    operationId: 'readMetrics',
    tags: ['diagnostics'],
    security: [{ diagnosticsToken: [] }],
    responses: {
      '200': {
        description: 'Redacted Prometheus metrics',
        content: { 'text/plain': { schema: { type: 'string' } } },
      },
      '503': { description: 'Metric collection unavailable' },
      '404': { description: 'Diagnostics disabled or operator token rejected' },
    },
  },
});

export default defineHandler({
  middleware: [protectDiagnostics],
  handler: async () => {
    const diagnostics = await readDatabaseDiagnostics(database).catch(() => undefined);
    const pressure = eventStreams.pressure();
    telemetry.streamPressure(pressure.connections, pressure.slowDisconnects);
    try {
      return new Response(await telemetry.metrics(diagnostics, database), {
        headers: {
          'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    } catch {
      return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  },
});
