import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import {
  createTelemetry,
  diagnosticsAuthorized,
  loadDiagnosticsToken,
  writeTelemetry,
} from '../src/telemetry.ts';

describe('protected redacted telemetry', () => {
  it('requires the exact dedicated bearer token', () => {
    const token = 'operator-secret-token-with-at-least-32-characters';
    expect(diagnosticsAuthorized(`Bearer ${token}`, token)).toBe(true);
    expect(diagnosticsAuthorized(`Bearer ${token}-extra`, token)).toBe(false);
    expect(diagnosticsAuthorized(`Basic ${token}`, token)).toBe(false);
    expect(diagnosticsAuthorized(null, token)).toBe(false);
    expect(diagnosticsAuthorized(`Bearer ${token}`, undefined)).toBe(false);
  });

  it('fails closed with a redacted configuration error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipong-telemetry-token-'));
    try {
      const path = join(directory, 'token');
      await writeFile(path, 'private-invalid-token');
      await expect(loadDiagnosticsToken(path)).rejects.toThrow(
        'TELEMETRY_CONFIG_INVALID: invalid DIAGNOSTICS_TOKEN_REF',
      );
      await expect(loadDiagnosticsToken('/missing/private-secret')).rejects.toThrow(
        'TELEMETRY_CONFIG_INVALID',
      );
      expect(await loadDiagnosticsToken(undefined)).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects secret-bearing metadata and arbitrary correlation strings', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      writeTelemetry({
        event: 'http_request',
        requestId: 'secret-as-correlation',
        route: 'domain',
        status: 200,
      });
      const event = { event: 'worker_started', password: 'private-password' } as const;
      writeTelemetry(event);
      expect(output).not.toHaveBeenCalled();
      writeTelemetry({ event: 'worker_started' });
      expect(output).toHaveBeenCalledWith('{"event":"worker_started"}');
    } finally {
      output.mockRestore();
    }
  });

  it('creates bounded request spans without a public metrics listener', async () => {
    const runtime = createTelemetry('api', false);
    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const span = runtime.startRequest('domain');
      expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
      runtime.finishRequest(span, 'domain', 503, 2, '019a0000-0000-7000-8000-000000000001');
      expect(output).toHaveBeenCalledOnce();
    } finally {
      output.mockRestore();
      await runtime.close();
    }
  });
  it('exports only allowlisted request span attributes over OTLP HTTP', async () => {
    const bodies: Buffer[] = [];
    const collector = createServer((request, response) => {
      request.on('data', (chunk: Buffer) => {
        bodies.push(chunk);
      });
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      });
    });
    collector.listen(0, '127.0.0.1');
    await once(collector, 'listening');
    const { port } = v.parse(v.object({ port: v.number() }), collector.address());
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', `http://127.0.0.1:${port}/v1/traces`);
    const runtime = createTelemetry('api', true);
    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      runtime.finishRequest(
        runtime.startRequest('domain'),
        'domain',
        200,
        1,
        '019a0000-0000-7000-8000-000000000001',
      );
      await runtime.close();
      const exported = Buffer.concat(bodies).toString();
      expect(exported).toContain('http.route');
      expect(exported).toContain('domain');
      expect(exported).not.toContain('url.full');
      expect(exported).not.toContain('019a0000-0000-7000-8000-000000000001');
    } finally {
      output.mockRestore();
      vi.unstubAllEnvs();
      await new Promise<void>((resolve, reject) =>
        collector.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }),
      );
    }
  });
});
