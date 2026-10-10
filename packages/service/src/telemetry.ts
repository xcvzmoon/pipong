import type { Span } from '@opentelemetry/api';
import type { DatabaseRuntime } from '@pipong/database';
import type { DatabaseDiagnostics } from '@pipong/database/telemetry';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { PrometheusExporter, PrometheusSerializer } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { readDatabaseDiagnostics } from '@pipong/database/telemetry';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as v from 'valibot';

export type RuntimeHealth = {
  status: 'ready' | 'unready';
  database: boolean;
  queues: boolean;
  consumers: boolean;
  configuration: boolean;
};
export type TelemetryRoute = 'auth' | 'domain' | 'events' | 'diagnostics' | 'other';
export type TelemetryEvent = {
  event:
    | 'http_request'
    | 'notification_accepted'
    | 'delivery_reserved'
    | 'delivery_settled'
    | 'worker_started'
    | 'worker_stopped'
    | 'recovery_scan_failed'
    | 'retention_scan_failed'
    | 'erasure_scan_failed'
    | 'worker_heartbeat_failed';
  requestId?: string;
  notificationId?: string;
  deliveryId?: string;
  attempt?: number;
  status?: number;
  durationMs?: number;
  route?: TelemetryRoute;
};
export type TelemetryRuntime = {
  startRequest: (route: TelemetryRoute) => Span;
  finishRequest: (
    span: Span,
    route: TelemetryRoute,
    status: number,
    durationMs: number,
    requestId: string,
  ) => void;
  metrics: (
    diagnostics: DatabaseDiagnostics | undefined,
    database: DatabaseRuntime,
  ) => Promise<string>;
  streamPressure: (connections: number, slowDisconnects: number) => void;
  close: () => Promise<void>;
};
const correlationSchema = v.optional(v.pipe(v.string(), v.uuid()));
const telemetryEventSchema = v.strictObject({
  event: v.picklist([
    'http_request',
    'notification_accepted',
    'delivery_reserved',
    'delivery_settled',
    'worker_started',
    'worker_stopped',
    'recovery_scan_failed',
    'retention_scan_failed',
    'erasure_scan_failed',
    'worker_heartbeat_failed',
  ]),
  requestId: correlationSchema,
  notificationId: correlationSchema,
  deliveryId: correlationSchema,
  attempt: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  status: v.optional(v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(599))),
  durationMs: v.optional(v.pipe(v.number(), v.minValue(0))),
  route: v.optional(v.picklist(['auth', 'domain', 'events', 'diagnostics', 'other'])),
});

/**
 * Writes only allowlisted structured fields. Invalid events are discarded.
 * Error messages, bodies, headers, URLs, and arbitrary metadata are never logged.
 * @param event - Fixed event name, bounded measurements, and UUID correlation IDs.
 * @returns Nothing; one JSON line is written for a valid event.
 * @example
 * ```ts
 * writeTelemetry({ event: 'worker_started' })
 * ```
 */
export function writeTelemetry(event: TelemetryEvent): void {
  const parsed = v.safeParse(telemetryEventSchema, event);
  if (parsed.success) {
    console.info(JSON.stringify(parsed.output));
  }
}

/**
 * Loads an optional operator bearer token from a protected secret file.
 * @param path - Absolute secret-file path, or undefined to disable diagnostics.
 * @returns UTF-8 token of 32 to 256 characters, or undefined when disabled.
 * @throws {Error} TELEMETRY_CONFIG_INVALID for an unreadable file or invalid token.
 * @example
 * ```ts
 * const token = await loadDiagnosticsToken(process.env.DIAGNOSTICS_TOKEN_REF)
 * ```
 */
export async function loadDiagnosticsToken(path: string | undefined): Promise<string | undefined> {
  if (path === undefined) {
    return undefined;
  }
  try {
    v.parse(v.pipe(v.string(), v.startsWith('/'), v.maxLength(4096)), path);
    const token = (await readFile(path, 'utf8')).trim();
    return v.parse(
      v.pipe(v.string(), v.minLength(32), v.maxLength(256), v.regex(/^[A-Za-z0-9._~-]+$/)),
      token,
    );
  } catch {
    throw new Error('TELEMETRY_CONFIG_INVALID: invalid DIAGNOSTICS_TOKEN_REF');
  }
}

/**
 * Compares the dedicated operator bearer token without using tenant authentication.
 * @param authorization - Request Authorization header.
 * @param token - Loaded operator secret; undefined denies every request.
 * @returns True only for an exact matching Bearer credential.
 * @example
 * ```ts
 * const permitted = diagnosticsAuthorized(request.headers.get('authorization'), token)
 * ```
 */
export function diagnosticsAuthorized(
  authorization: string | null,
  token: string | undefined,
): boolean {
  if (!token || !authorization?.startsWith('Bearer ')) {
    return false;
  }
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/**
 * Checks local database/schema access and fresh worker consumer leases.
 * @param database - API runtime.
 * @param configuration - Whether the operator keyring can currently be loaded.
 * @returns Ready only when all queues and mail/APNs/FCM/Web Push consumers are available. Third-party sends are never probed. Infrastructure failure yields unready.
 * @example
 * ```ts
 * const health = await readRuntimeHealth(database, true)
 * ```
 */
export async function readRuntimeHealth(
  database: DatabaseRuntime,
  configuration: boolean,
): Promise<RuntimeHealth> {
  try {
    const diagnostics = await readDatabaseDiagnostics(database);
    const consumers = ['auth-email', 'apns', 'fcm', 'web-push'].every((consumer) =>
      diagnostics.consumers.some((entry) => entry === consumer),
    );
    return {
      status: diagnostics.queuesReady && consumers && configuration ? 'ready' : 'unready',
      database: true,
      queues: diagnostics.queuesReady,
      consumers,
      configuration,
    };
  } catch {
    return { status: 'unready', database: false, queues: false, consumers: false, configuration };
  }
}

/**
 * Creates process-owned OpenTelemetry metrics and explicitly allowlisted request spans.
 * No public listener is started. An optional OTLP HTTP trace exporter uses its standard
 * environment configuration. Exported spans contain fixed route groups and status only.
 * @param role - Deployable identity.
 * @param exportTraces - Enable OTLP export when an operator collector is configured.
 * @returns Protected-scrape serializer and lifecycle hooks. Call close during shutdown.
 * @throws {Error} SDK initialization and collection failures propagate.
 * @example
 * ```ts
 * const telemetry = createTelemetry('api', false)
 * try { await runApi(telemetry) } finally { await telemetry.close() }
 * ```
 */
export function createTelemetry(role: 'api' | 'worker', exportTraces: boolean): TelemetryRuntime {
  const reader = new PrometheusExporter({ preventServerStart: true });
  const serializer = new PrometheusSerializer('pipong', false, undefined, true, true);
  const meters = new MeterProvider({ readers: [reader] });
  const traces = new BasicTracerProvider({
    spanProcessors: exportTraces
      ? [
          new BatchSpanProcessor(new OTLPTraceExporter({ timeoutMillis: 3000 }), {
            maxQueueSize: 512,
            maxExportBatchSize: 64,
            exportTimeoutMillis: 3000,
          }),
        ]
      : [],
  });
  const tracer = traces.getTracer('pipong');
  const meter = meters.getMeter('pipong');
  const requests = meter.createCounter('http_requests');
  const duration = meter.createHistogram('http_request_duration_seconds', { unit: 's' });
  let latest: DatabaseDiagnostics | undefined;
  let pool: DatabaseRuntime | undefined;
  let streamConnections = 0;
  let slowStreamDisconnects = 0;
  meter.createObservableGauge('sse_connections').addCallback((result) => {
    result.observe(streamConnections, { role });
  });
  meter.createObservableGauge('sse_slow_disconnects').addCallback((result) => {
    result.observe(slowStreamDisconnects, { role });
  });
  meter.createObservableGauge('database_available').addCallback((result) => {
    result.observe(latest ? 1 : 0, { role });
  });
  meter.createObservableGauge('pool_connections').addCallback((result) => {
    if (pool) {
      result.observe(pool.pool.totalCount, { role, state: 'total' });
      result.observe(pool.pool.idleCount, { role, state: 'idle' });
      result.observe(pool.pool.waitingCount, { role, state: 'waiting' });
    }
  });
  meter.createObservableGauge('queue_jobs').addCallback((result) => {
    for (const queue of latest?.queues ?? []) {
      result.observe(queue.pending, { queue: queue.name, state: 'pending' });
      result.observe(queue.active, { queue: queue.name, state: 'active' });
      result.observe(queue.failed, { queue: queue.name, state: 'failed' });
    }
  });
  meter.createObservableGauge('queue_oldest_seconds').addCallback((result) => {
    for (const queue of latest?.queues ?? []) {
      result.observe(queue.oldestSeconds, { queue: queue.name });
    }
  });
  meter.createObservableGauge('consumer_available').addCallback((result) => {
    for (const consumer of ['auth-email', 'apns', 'fcm', 'web-push']) {
      result.observe(latest?.consumers.some((entry) => entry === consumer) ? 1 : 0, { consumer });
    }
  });
  meter.createObservableGauge('recovery_work').addCallback((result) => {
    if (latest) {
      result.observe(latest.ambiguous, { kind: 'ambiguous' });
      result.observe(latest.pendingErasures, { kind: 'erasure' });
      result.observe(latest.credentialFailures, { kind: 'credential_failure_last_hour' });
    }
  });
  return {
    startRequest: (route) =>
      tracer.startSpan(route, { kind: SpanKind.SERVER, attributes: { 'http.route': route } }),
    finishRequest: (span, route, status, durationMs, requestId) => {
      const labels = { role, route, status: String(status) };
      requests.add(1, labels);
      duration.record(durationMs / 1000, labels);
      span.setAttribute('http.response.status_code', status);
      if (status >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
      writeTelemetry({ event: 'http_request', route, status, durationMs, requestId });
    },
    metrics: async (diagnostics, database) => {
      latest = diagnostics;
      pool = database;
      const collected = await reader.collect({ timeoutMillis: 1500 });
      if (collected.errors.length > 0) {
        throw new Error('TELEMETRY_COLLECTION_FAILED');
      }
      return serializer.serialize(collected.resourceMetrics);
    },
    streamPressure: (connections, slowDisconnects) => {
      streamConnections = connections;
      slowStreamDisconnects = slowDisconnects;
    },
    close: async () => {
      await Promise.all([meters.shutdown(), traces.shutdown()]);
    },
  };
}
