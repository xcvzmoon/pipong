#!/bin/sh
set -eu
export API_PASSWORD="$(cat /run/secrets/api-password)"
export WORKER_PASSWORD="$(cat /run/secrets/worker-password)"
export MIGRATOR_PASSWORD="$(cat /run/secrets/migrator-password)"
psql -v ON_ERROR_STOP=1 -v DBNAME="$POSTGRES_DB" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /opt/pipong/provision.sql
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv api_password API_PASSWORD
\getenv worker_password WORKER_PASSWORD
\getenv migrator_password MIGRATOR_PASSWORD
ALTER ROLE pipong_api PASSWORD :'api_password';
ALTER ROLE pipong_worker PASSWORD :'worker_password';
ALTER ROLE pipong_migrator PASSWORD :'migrator_password';
SQL
