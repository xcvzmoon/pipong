import { defineEnv, EnvValidationError } from '@xcvzlabs/env';
import * as v from 'valibot';

export type EnvironmentSource = Record<string, string | undefined>;

export type ApiConfig = {
  authBaseUrl: string;
  authSecret: string;
  credentialKeyringRef: string;
};

export type WorkerConfig = {
  credentialKeyringRef: string;
  apnsEnvironment: 'production' | 'sandbox';
  fcmProjectId: string | undefined;
  webPushSubject: string | undefined;
};

export type ConfigErrorCode = 'API_CONFIG_INVALID' | 'WORKER_CONFIG_INVALID';

export class ConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(code: ConfigErrorCode, variables: string[]) {
    super(`${code}: invalid configuration for ${variables.join(', ')}`);
    this.name = 'ConfigError';
    this.code = code;
  }
}

const requiredStringSchema = v.pipe(v.string(), v.trim(), v.nonEmpty());
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

export function parseApiConfig(source: EnvironmentSource): ApiConfig {
  const values = parseConfig('API_CONFIG_INVALID', () =>
    defineEnv({
      source,
      schema: {
        AUTH_BASE_URL: canonicalAuthUrlSchema(),
        AUTH_SECRET: authSecretSchema,
        CREDENTIAL_KEYRING_REF: requiredStringSchema,
      },
    }),
  );
  return {
    authBaseUrl: values.AUTH_BASE_URL,
    authSecret: values.AUTH_SECRET,
    credentialKeyringRef: values.CREDENTIAL_KEYRING_REF,
  };
}

export function parseWorkerConfig(source: EnvironmentSource): WorkerConfig {
  const values = parseConfig('WORKER_CONFIG_INVALID', () =>
    defineEnv({
      source,
      schema: {
        CREDENTIAL_KEYRING_REF: requiredStringSchema,
        APNS_ENVIRONMENT: v.optional(v.picklist(['production', 'sandbox']), 'production'),
        FCM_PROJECT_ID: v.optional(v.pipe(v.string(), v.trim(), v.nonEmpty())),
        WEB_PUSH_SUBJECT: v.optional(webPushSubjectSchema),
      },
    }),
  );
  return {
    credentialKeyringRef: values.CREDENTIAL_KEYRING_REF,
    apnsEnvironment: values.APNS_ENVIRONMENT,
    fcmProjectId: values.FCM_PROJECT_ID,
    webPushSubject: values.WEB_PUSH_SUBJECT,
  };
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

export function loadApiConfig(): ApiConfig {
  return parseApiConfig(process.env);
}

export function loadWorkerConfig(): WorkerConfig {
  return parseWorkerConfig(process.env);
}
