# Runtime configuration

The API and worker validate their own settings when they start. Invalid settings stop startup with `API_CONFIG_INVALID` or `WORKER_CONFIG_INVALID`; the message names affected environment variables and never prints their values.

## API

| Variable                 | Required | Default | Purpose                                                                                                                                                               |
| ------------------------ | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_BASE_URL`          | Yes      |         | Canonical public HTTP origin used by authentication. HTTPS is required except for HTTP on `localhost`. Paths, credentials, query strings, and fragments are rejected. |
| `AUTH_SECRET`            | Yes      |         | Secret used by the authentication service. Supply at least 32 characters through the deployment secret manager.                                                       |
| `CREDENTIAL_KEYRING_REF` | Yes      |         | Operator controlled reference to the credential encryption keyring. Key material itself is not read from this setting.                                                |
| `API_DATABASE_POOL_MAX`  | No       | `8`     | API process database pool budget, from 1 to 100.                                                                                                                      |

`DATABASE_URL` is validated by the database package and is shared as the connection target. Its URL validation is not repeated by the API config parser.

The API and worker budgets are validated independently. Database client construction is integrated in a later persistence phase, so these values are not yet applied to live connection pools.

## Worker

| Variable                   | Required | Default      | Purpose                                                                                                |
| -------------------------- | -------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `CREDENTIAL_KEYRING_REF`   | Yes      |              | The same operator managed keyring reference used by API processes.                                     |
| `WORKER_DATABASE_POOL_MAX` | No       | `12`         | Worker process database pool budget, from 1 to 100. This budget is independent of the API pool budget. |
| `APNS_ENVIRONMENT`         | No       | `production` | APNs target environment: `production` or `sandbox`.                                                    |
| `FCM_PROJECT_ID`           | No       |              | Explicit Firebase target project identifier.                                                           |
| `WEB_PUSH_SUBJECT`         | No       |              | VAPID contact subject: a `mailto:` email address or an HTTPS URL without credentials or a fragment.    |

Provider credentials remain tenant credential records and are not process environment settings. The worker currently validates these settings but does not start provider adapters in this phase.

For local development, set values in your shell or an ignored `.env` file. Do not put real secrets in `.env.example` or command history. The API and worker require their own configuration even when started from the same checkout.
