#!/bin/sh
set -eu
for config in drizzle.migrate.config.ts drizzle.auth.migrate.config.ts drizzle.tenancy.migrate.config.ts; do
  node --env-file=/run/secrets/migration.env node_modules/drizzle-kit/bin.cjs migrate --config "$config"
done
