import { APIError, createAuthMiddleware } from 'better-auth/api';
import * as v from 'valibot';

const deviceTrustSchema = v.object({ trustDevice: v.optional(v.boolean(), false) });

export const enforceMfaPolicy = createAuthMiddleware(async (context) => {
  if (
    context.path === '/two-factor/verify-totp' ||
    context.path === '/two-factor/verify-backup-code'
  ) {
    const parsed = v.safeParse(deviceTrustSchema, context.body);

    if (parsed.success && parsed.output.trustDevice) {
      throw new APIError('FORBIDDEN', {
        code: 'AUTH_DEVICE_TRUST_DISABLED',
        message: 'Trusted devices are disabled. Complete MFA on every sign-in.',
      });
    }
  }

  if (context.path === '/sign-in/email') {
    const cookie = context.context.createAuthCookie('trust_device');
    const trustedDevice = await context.getSignedCookie(cookie.name, context.context.secret);

    if (trustedDevice) {
      const identifier = trustedDevice.split('!')[1];

      if (identifier?.startsWith('trust-device-')) {
        await context.context.internalAdapter.deleteVerificationByIdentifier(identifier);
      }
    }
  }
});
