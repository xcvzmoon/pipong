import { handleAuthRequest } from '@pipong/auth';
import { defineHandler } from 'nitro';
import { getRequestIP } from 'nitro/h3';
import { auth } from '../../utils/auth.ts';

export default defineHandler((event) => {
  const clientIp = getRequestIP(event, { xForwardedFor: false });
  if (!clientIp) {
    return Response.json(
      {
        type: 'about:blank',
        title: 'Service unavailable',
        status: 503,
        code: 'AUTH_CLIENT_ADDRESS_UNAVAILABLE',
      },
      {
        status: 503,
        headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' },
      },
    );
  }
  event.req.headers.set('x-pipong-client-ip', clientIp);
  return handleAuthRequest(auth, event.req);
});
