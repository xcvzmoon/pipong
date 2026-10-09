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

export type { EndpointInput } from './endpoints.ts';
export {
  endpointInputSchema,
  endpointPathSchema,
  endpointDisableSchema,
  registerEndpoint,
  listEndpoints,
  readEndpoint,
  disableEndpoint,
} from './endpoints.ts';

export type {
  NotificationRequest,
  NotificationResult,
  ApiProblem,
} from './notification-contract.ts';
export {
  notificationLimits,
  notificationRequestSchema,
  parseNotificationRequest,
  boundNotificationTargets,
} from './notification-contract.ts';
export type { PayloadDestination, DeliveryIdentity, ProviderPayload } from './provider-payloads.ts';
export { encodeProviderPayload } from './provider-payloads.ts';

export type { DeliveryJob, QueueRuntime } from '@pipong/database/delivery-queue';
export { startDeliveryQueue, completeDeliveryJob } from '@pipong/database/delivery-queue';
export { deliveryJobSchema, enqueueDelivery } from './queue.ts';
export { admitNotification, releaseNotificationCapacity } from './limits.ts';
export type { AdmissionDecision, TenantBudget } from './limits.ts';
export { fetchDeliveryJobs } from '@pipong/database/delivery-queue';

export { recordDeliveryEvent, replayDeliveryEvents, deliveryEventInputSchema } from './events.ts';
export type {
  DeliveryEvent,
  EventCursor,
  ReplayWatermark,
  EventPage,
  EventReplayResult,
} from './events.ts';

export { submitNotification, idempotencyKeySchema } from './submit-notification.ts';
export type { SubmissionResult } from './submit-notification.ts';
