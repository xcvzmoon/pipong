import { createTelemetry, diagnosticsAuthorized, loadDiagnosticsToken } from '@pipong/service';
import { defineHandler } from 'nitro';

export const telemetry = createTelemetry(
  'api',
  Boolean(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  ),
);
const diagnosticsToken = await loadDiagnosticsToken(process.env.DIAGNOSTICS_TOKEN_REF);

export const protectDiagnostics = defineHandler((event) => {
  event.res.headers.set('cache-control', 'no-store');
  if (!diagnosticsAuthorized(event.req.headers.get('authorization'), diagnosticsToken)) {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  return undefined;
});
