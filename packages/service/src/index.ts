export type { DomainAction, AuthorizationFailure, AuthorizedResult } from './authorize.ts';
export { domainActionSchema, withAuthorizedTransaction } from './authorize.ts';
export {
  createProject,
  listProjects,
  readProject,
  updateProject,
  suspendProject,
} from './projects.ts';
export {
  createEnvironment,
  listEnvironments,
  readEnvironment,
  updateEnvironment,
  suspendEnvironment,
} from './environments.ts';
export type { ResourceResult, ResourceFailure, ResourcePage } from './resources.ts';
export {
  resourceInputSchema,
  resourcePageSchema,
  organizationPathSchema,
  projectPathSchema,
  environmentPathSchema,
} from './resources.ts';

export type {
  ServiceKeyActor,
  ServiceKeyResult,
  ServiceKeyInput,
  ServiceKeyRotation,
} from './service-keys.ts';
export {
  serviceKeyInputSchema,
  serviceKeyRotationSchema,
  serviceKeyPathSchema,
  issueServiceKey,
  listServiceKeys,
  rotateServiceKey,
  revokeServiceKey,
} from './service-keys.ts';

export {
  recipientInputSchema,
  recipientPathSchema,
  upsertRecipient,
  listRecipients,
  readRecipient,
  deleteRecipient,
} from './recipients.ts';

export type { CredentialInput } from './credentials.ts';
export {
  credentialInputSchema,
  credentialPathSchema,
  createCredentialVersion,
  listCredentialVersions,
  readCredentialVersion,
  activateCredentialVersion,
  retireCredentialVersion,
  rotateCredentialEncryption,
} from './credentials.ts';
export type { SecretKeyring, SecretContext, EncryptedValue } from './secrets.ts';
export { loadSecretKeyring, encryptSecret, decryptSecret } from './secrets.ts';

export type { EgressPolicy, AllowedDestination, DestinationResolver } from './egress.ts';
export { loadEgressPolicy, validateDestination } from './egress.ts';
export type { WebPushResponse } from './web-push-transport.ts';
export { sendWebPushRequest } from './web-push-transport.ts';
