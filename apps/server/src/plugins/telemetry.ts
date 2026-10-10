import type { TelemetryRoute } from '@pipong/service';
import { definePlugin } from 'nitro';
import { getEventContext } from 'nitro/h3';
import { v7 } from 'uuid';
import { telemetry } from '../utils/telemetry.ts';

function routeGroup(path: string): TelemetryRoute {
  if (path === '/metrics' || path.startsWith('/health/')) {
    return 'diagnostics';
  }
  if (path.startsWith('/api/auth/')) {
    return 'auth';
  }
  if (path.startsWith('/api/v1/')) {
    return path.endsWith('/events/stream') ? 'events' : 'domain';
  }
  return 'other';
}

export default definePlugin((nitroApp) => {
  const requests = new WeakMap<
    Request,
    {
      span: ReturnType<typeof telemetry.startRequest>;
      startedAt: number;
      route: TelemetryRoute;
      requestId: string;
    }
  >();
  nitroApp.hooks.hook('request', (event) => {
    const route = routeGroup(new URL(event.req.url).pathname);
    const requestId = v7();
    getEventContext(event).requestId = requestId;
    requests.set(event.req, {
      span: telemetry.startRequest(route),
      startedAt: performance.now(),
      route,
      requestId,
    });
  });
  nitroApp.hooks.hook('response', (response, event) => {
    const request = requests.get(event.req);
    if (request) {
      response.headers.set('x-request-id', request.requestId);
      requests.delete(event.req);
      telemetry.finishRequest(
        request.span,
        request.route,
        response.status,
        performance.now() - request.startedAt,
        request.requestId,
      );
    }
  });
  nitroApp.hooks.hook('close', () => telemetry.close());
});
