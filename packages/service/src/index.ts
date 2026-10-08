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
