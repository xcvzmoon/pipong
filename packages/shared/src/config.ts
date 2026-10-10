import { defineEnv, EnvValidationError } from '@xcvzlabs/env';
import * as v from 'valibot';

/**
 * Environment variable values supplied to configuration parsers.
 */
export type EnvironmentSource = Record<string, string | undefined>;

/**
 * Validated API authentication and credential keyring settings.
 */
export type ApiConfig = {
  authBaseUrl: string;
  authSecret: string;
  credentialKeyringRef: string;
};

/**
 * Validated worker settings; push consumers require explicit operator enablement.
 */
export type WorkerConfig = {
  credentialKeyringRef: string;
  apnsEnvironment: 'production' | 'sandbox';
  fcmProjectId: string | undefined;
} & (
  | { pushDeliveryEnabled: false; webPushSubject: string | undefined }
  | { pushDeliveryEnabled: true; webPushSubject: string }
);

/**
 * Stable error codes for API and worker configuration failures.
 */
export type ConfigErrorCode = 'API_CONFIG_INVALID' | 'WORKER_CONFIG_INVALID';

/**
 * Configuration error exposing a stable code and invalid variable names without their values.
 */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(code: ConfigErrorCode, variables: string[]) {
    super(`${code}: invalid configuration for ${variables.join(', ')}`);
    this.name = 'ConfigError';
    this.code = code;
  }
}

const requiredStringSchema = v.pipe(v.string(), v.trim(), v.nonEmpty());
const keyringPathSchema = v.pipe(requiredStringSchema, v.startsWith('/'), v.excludes('\0'));
const authSecretSchema = v.pipe(requiredStringSchema, v.minLength(32));
function canonicalAuthUrlSchema(): v.GenericSchema<string> {
  return v.pipe(
    requiredStringSchema,
    v.url(),
    v.rawCheck(({ dataset, addIssue }) => {
      if (!dataset.typed) return;
      let url: URL;
      try {
        url = new URL(dataset.value);
      } catch {
        addIssue({ message: 'must be a canonical HTTP origin' });
        return;
      }
      const localHttp = url.protocol === 'http:' && url.hostname === 'localhost';
      if (
        (url.protocol !== 'https:' && !localHttp) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      ) {
        addIssue({ message: 'must be a canonical HTTP origin' });
      }
    }),
  );
}

function parseConfig<T>(code: ConfigErrorCode, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      const variables: string[] = [];
      for (const issue of error.issues) {
        variables.push(issue.envVar);
      }
      throw new ConfigError(code, [...new Set(variables)]);
    }
    throw new ConfigError(code, ['environment']);
  }
}

/**
 * Validates and normalizes API settings without opening external connections.
 *
 * @param source - Environment values to parse; unrelated keys are ignored.
 * @returns Validated settings. AUTH_BASE_URL must be HTTPS, or HTTP on localhost, with no path, credentials, query, or fragment. The keyring reference must be an absolute file path; this parser does not read it.
 * @throws {ConfigError} API_CONFIG_INVALID when required values are missing or invalid.
 *
 * @example
 * ```ts
 * const config = parseApiConfig({
 *   AUTH_BASE_URL: 'http://localhost:3000',
 *   AUTH_SECRET: 'development-secret-at-least-32-characters',
 *   CREDENTIAL_KEYRING_REF: '/run/secrets/credential-keyring.json',
 * });
 * ```
 */
export function parseApiConfig(source: EnvironmentSource): ApiConfig {
  const values = parseConfig('API_CONFIG_INVALID', () =>
    defineEnv({
      source,
      schema: {
        AUTH_BASE_URL: canonicalAuthUrlSchema(),
        AUTH_SECRET: authSecretSchema,
        CREDENTIAL_KEYRING_REF: keyringPathSchema,
      },
    }),
  );
  return {
    authBaseUrl: values.AUTH_BASE_URL,
    authSecret: values.AUTH_SECRET,
    credentialKeyringRef: values.CREDENTIAL_KEYRING_REF,
  };
}

/**
 * Validates and normalizes worker settings without opening external connections.
 *
 * @param source - Environment values to parse; unrelated keys are ignored.
 * @returns Validated settings with APNS defaulting to production and an absolute keyring file path. Push delivery defaults to disabled; enabling it requires WEB_PUSH_SUBJECT. This parser does not read the file.
 * @throws {ConfigError} WORKER_CONFIG_INVALID when required values are missing or invalid.
 *
 * @example
 * ```ts
 * const config = parseWorkerConfig({
 *   CREDENTIAL_KEYRING_REF: '/run/secrets/credential-keyring.json',
 *   APNS_ENVIRONMENT: 'sandbox',
 * });
 * ```
 */
export function parseWorkerConfig(source: EnvironmentSource): WorkerConfig {
  const values = parseConfig('WORKER_CONFIG_INVALID', () =>
    defineEnv({
      source,
      schema: {
        CREDENTIAL_KEYRING_REF: keyringPathSchema,
        APNS_ENVIRONMENT: v.optional(v.picklist(['production', 'sandbox']), 'production'),
        PUSH_DELIVERY_ENABLED: v.optional(v.picklist(['true', 'false']), 'false'),
        FCM_PROJECT_ID: v.optional(v.pipe(v.string(), v.trim(), v.nonEmpty())),
        WEB_PUSH_SUBJECT: v.optional(webPushSubjectSchema),
      },
    }),
  );
  const settings = {
    credentialKeyringRef: values.CREDENTIAL_KEYRING_REF,
    apnsEnvironment: values.APNS_ENVIRONMENT,
    fcmProjectId: values.FCM_PROJECT_ID,
  };
  if (values.PUSH_DELIVERY_ENABLED === 'true') {
    if (!values.WEB_PUSH_SUBJECT) {
      throw new ConfigError('WORKER_CONFIG_INVALID', ['WEB_PUSH_SUBJECT']);
    }
    return { ...settings, pushDeliveryEnabled: true, webPushSubject: values.WEB_PUSH_SUBJECT };
  }
  return { ...settings, pushDeliveryEnabled: false, webPushSubject: values.WEB_PUSH_SUBJECT };
}

const mailtoSubjectSchema = v.pipe(
  requiredStringSchema,
  v.startsWith('mailto:'),
  v.transform((value) => value.slice('mailto:'.length)),
  v.email(),
  v.transform((value) => `mailto:${value}`),
);
const httpsContactUrlSchema = v.pipe(
  requiredStringSchema,
  v.url(),
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) return;
    try {
      const url = new URL(dataset.value);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
        addIssue({ message: 'must be a credential-free HTTPS contact URL' });
      }
    } catch {
      addIssue({ message: 'must be a valid HTTPS contact URL' });
    }
  }),
);
const webPushSubjectSchema = v.union([mailtoSubjectSchema, httpsContactUrlSchema]);

/**
 * Loads API settings from the current process environment.
 *
 * @returns Validated API settings.
 * @throws {ConfigError} API_CONFIG_INVALID when the environment is invalid.
 *
 * @example
 * ```ts
 * const config = loadApiConfig();
 * ```
 */
export function loadApiConfig(): ApiConfig {
  return parseApiConfig(process.env);
}

/**
 * Loads worker settings from the current process environment.
 *
 * @returns Validated worker settings.
 * @throws {ConfigError} WORKER_CONFIG_INVALID when the environment is invalid.
 *
 * @example
 * ```ts
 * const config = loadWorkerConfig();
 * ```
 */
export function loadWorkerConfig(): WorkerConfig {
  return parseWorkerConfig(process.env);
}
