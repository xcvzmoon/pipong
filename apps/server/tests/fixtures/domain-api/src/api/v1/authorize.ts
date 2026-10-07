import { tenantScopeSchema } from '@pipong/database/tenancy';
import { domainActionSchema } from '@pipong/service';
import { defineHandler } from 'nitro';
import * as v from 'valibot';
import { withAuthorizedRequest } from '../../../../../../src/utils/authorize.ts';
import { problemResponse } from '../../../../../../src/utils/problem.ts';

const inputSchema = v.strictObject({ action: domainActionSchema, scope: tenantScopeSchema });

export default defineHandler(async (event) => {
  const input = v.safeParse(inputSchema, await event.req.json());

  if (!input.success) {
    return problemResponse(
      422,
      'AUTHORIZATION_INPUT_INVALID',
      event.context.requestId ?? 'unavailable',
    );
  }

  return withAuthorizedRequest(
    event,
    input.output.action,
    input.output.scope,
    async (transaction) => {
      if (event.url.searchParams.get('hold') === 'true') {
        await transaction.execute('SELECT pg_advisory_xact_lock(80808)');
      }

      const result = await transaction.execute(
        "SELECT current_setting('pipong.organization_id') AS organization_id, current_setting('pipong.project_id') AS project_id, current_setting('pipong.environment_id') AS environment_id",
      );
      return Response.json({ authorized: true, scope: result.rows[0] });
    },
  );
});
