import { disableEndpoint, endpointPathSchema } from '@pipong/service';
import { defineHandler } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '~/utils/authorize.ts';
import { resourceResponse } from '~/utils/resources.ts';

const invalidationSchema = v.strictObject({
  generation: v.pipe(v.number(), v.integer(), v.minValue(1)),
  invalidatedAt: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(8640000000000000)),
});

export default defineHandler(async (event) => {
  const { organizationId, projectId, environmentId, recipientId, endpointId } = v.parse(
    endpointPathSchema,
    event.context.params,
  );
  const input = v.parse(invalidationSchema, await event.req.json());
  const scope = { kind: 'environment', organizationId, projectId, environmentId } as const;
  return withAuthorizedRequest(event, 'endpoint:write', scope, async (transaction) =>
    resourceResponse(
      event,
      await disableEndpoint(
        transaction,
        scope,
        recipientId,
        endpointId,
        input.generation,
        new Date(input.invalidatedAt),
      ),
    ),
  );
});
