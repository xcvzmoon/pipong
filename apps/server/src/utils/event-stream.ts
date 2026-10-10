import type { EnvironmentScope } from '@pipong/database/recipients';
import type { StreamSubscription } from '@pipong/service';
import type { H3Event } from 'nitro/h3';
import { createEventStreamRuntime } from '@pipong/service';
import { EventStream, toResponse } from 'nitro/h3';
import { database } from './auth.ts';
import { problemResponse } from './problem.ts';

export const eventStreams = createEventStreamRuntime(database);

export async function openEventStream(
  event: H3Event,
  scope: EnvironmentScope,
  cursor: string | undefined,
): Promise<Response> {
  const { principal } = event.context;
  const requestId = event.context.requestId ?? 'unavailable';
  if (!principal) {
    return problemResponse(401, 'AUTH_CREDENTIALS_INVALID', requestId);
  }
  const stream = new EventStream(event);
  const response = await toResponse(stream, event);
  const reader = response.body?.getReader();
  if (!reader) {
    return problemResponse(503, 'EVENT_STREAM_UNAVAILABLE', requestId);
  }
  let subscription: StreamSubscription | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;

  function disconnect(): void {
    if (closed) {
      return;
    }
    closed = true;
    event.req.signal.removeEventListener('abort', disconnect);
    subscription?.disconnect();
    controller?.close();
    void reader?.cancel().catch(() => {});
    void stream.close().catch(() => {});
  }

  stream.onClosed(disconnect);
  event.req.signal.addEventListener('abort', disconnect, { once: true });
  try {
    const result = await eventStreams.subscribe(
      principal,
      scope,
      cursor,
      (message) =>
        message.kind === 'heartbeat'
          ? stream.pushComment('heartbeat')
          : stream.push({
              id: message.value.id,
              event: 'delivery',
              data: JSON.stringify(message.value),
            }),
      disconnect,
    );
    if (!result.ok) {
      disconnect();
      const problem = problemResponse(result.status, result.code, requestId);
      if (result.status === 429) {
        problem.headers.set('retry-after', '5');
      }
      return problem;
    }
    subscription = result.value;
    if (closed || event.req.signal.aborted) {
      subscription.disconnect();
      disconnect();
    }
    const body = new ReadableStream<Uint8Array>(
      {
        start(output) {
          controller = output;
          if (closed) {
            output.close();
          }
        },
        async pull(output) {
          try {
            const chunk = await reader.read();
            if (closed) {
              return;
            }
            if (chunk.done) {
              disconnect();
            } else {
              output.enqueue(chunk.value);
            }
          } catch {
            disconnect();
          }
        },
        cancel() {
          controller = undefined;
          disconnect();
        },
      },
      { highWaterMark: 0 },
    );
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-accel-buffering', 'no');
    response.headers.set('x-request-id', requestId);
    return new Response(body, { headers: response.headers });
  } catch {
    disconnect();
    console.error('EVENT_STREAM_UNAVAILABLE: stream startup failed');
    return problemResponse(503, 'EVENT_STREAM_UNAVAILABLE', requestId);
  }
}
