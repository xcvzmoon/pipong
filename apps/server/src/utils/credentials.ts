import type { CredentialInput, SecretKeyring } from '@pipong/service';
import type { H3Event } from 'nitro/h3';
import { credentialInputSchema, loadSecretKeyring } from '@pipong/service';
import { loadApiConfig } from '@pipong/shared';
import { assertBodySize, HTTPError } from 'nitro/h3';
import * as v from 'valibot';
import { problemResponse } from './problem.ts';

export async function readCredentialInput(event: H3Event): Promise<CredentialInput | Response> {
  const requestId = event.context.requestId ?? 'unavailable';

  if (
    event.req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    return problemResponse(415, 'RESOURCE_CONTENT_TYPE_INVALID', requestId);
  }

  try {
    assertBodySize(event, 32768);
    const parsed = v.safeParse(credentialInputSchema, await event.req.json());

    if (!parsed.success) {
      return problemResponse(422, 'RESOURCE_INPUT_INVALID', requestId);
    }

    return parsed.output;
  } catch (error) {
    if (error instanceof HTTPError && error.status === 413) {
      return problemResponse(413, 'RESOURCE_BODY_TOO_LARGE', requestId);
    }

    return problemResponse(422, 'RESOURCE_INPUT_INVALID', requestId);
  }
}

export function credentialKeyring(): Promise<SecretKeyring> {
  return loadSecretKeyring(loadApiConfig().credentialKeyringRef);
}
