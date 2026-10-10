#!/bin/sh
set -eu
: "${PIPONG_VERSION:?Set PIPONG_VERSION to the built image version}"
smoke_directory=$(mktemp -d)
export PIPONG_SECRETS_DIR="$smoke_directory/secrets"
mkdir "$PIPONG_SECRETS_DIR"
project="pipong-ci-$$"
compose() {
  docker compose -p "$project" -f compose.yaml -f "$smoke_directory/images.yaml" --profile tools "$@"
}
cleanup() {
  result=$?
  trap - EXIT
  set +e
  if [ "$result" -ne 0 ]; then
    compose logs --tail 100 >&2
  fi
  compose down --volumes --remove-orphans
  rm -rf "$smoke_directory"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cat > "$smoke_directory/images.yaml" <<YAML
services:
  database:
    image: pipong-database:$PIPONG_VERSION
  migrate:
    image: pipong-migrate:$PIPONG_VERSION
  operator:
    image: pipong-server:$PIPONG_VERSION
  api:
    image: pipong-server:$PIPONG_VERSION
    ports: !override ['127.0.0.1::3000']
  worker:
    image: pipong-worker:$PIPONG_VERSION
YAML
for secret in admin api worker migrator; do
  openssl rand -hex 24 > "$PIPONG_SECRETS_DIR/$secret-password"
done
openssl rand -hex 32 > "$PIPONG_SECRETS_DIR/diagnostics-token"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=database \
  -addext subjectAltName=DNS:database \
  -keyout "$PIPONG_SECRETS_DIR/database.key" \
  -out "$PIPONG_SECRETS_DIR/database.crt" 2>/dev/null
cp "$PIPONG_SECRETS_DIR/database.crt" "$PIPONG_SECRETS_DIR/database-ca.crt"
printf '{"activeKeyId":"ci","keys":{"ci":"%s"}}\n' "$(openssl rand -hex 32)" > "$PIPONG_SECRETS_DIR/credential-keyring.json"
cat > "$PIPONG_SECRETS_DIR/api.env" <<ENV
AUTH_BASE_URL=https://notifications.example.com
AUTH_SECRET=$(openssl rand -hex 32)
DIAGNOSTICS_TOKEN_REF=/run/secrets/diagnostics-token
API_DATABASE_URL=postgres://pipong_api:$(cat "$PIPONG_SECRETS_DIR/api-password")@database:5432/pipong?sslmode=verify-full&sslrootcert=/run/secrets/database-ca
CREDENTIAL_KEYRING_REF=/run/secrets/credential-keyring.json
ENV
cat > "$PIPONG_SECRETS_DIR/worker.env" <<ENV
WORKER_DATABASE_URL=postgres://pipong_worker:$(cat "$PIPONG_SECRETS_DIR/worker-password")@database:5432/pipong?sslmode=verify-full&sslrootcert=/run/secrets/database-ca
CREDENTIAL_KEYRING_REF=/run/secrets/credential-keyring.json
AUTH_MAIL_FROM=auth@example.com
SMTP_HOST=localhost
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_USER=ci
SMTP_PASSWORD=$(openssl rand -hex 24)
APNS_ENVIRONMENT=production
ENV
cat > "$PIPONG_SECRETS_DIR/migration.env" <<ENV
MIGRATION_DATABASE_URL=postgres://pipong_migrator:$(cat "$PIPONG_SECRETS_DIR/migrator-password")@database:5432/pipong?sslmode=verify-full&sslrootcert=/run/secrets/database-ca
ENV
chmod 0755 "$smoke_directory" "$PIPONG_SECRETS_DIR"
chmod 0444 "$PIPONG_SECRETS_DIR"/*
for artifact in server worker migrate; do
  test "$(docker image inspect "pipong-$artifact:$PIPONG_VERSION" --format '{{.Config.User}}')" = node
done
compose up -d --wait --wait-timeout 120 --no-build database
compose run --rm --no-deps --pull never migrate
compose run --rm --no-deps --pull never migrate
printf '{"action":"bootstrap","name":"CI owner","email":"owner@example.com","password":"%s","organizationName":"CI installation","organizationSlug":"ci-installation"}\n' "$(openssl rand -hex 24)" > "$smoke_directory/bootstrap.json"
compose run --rm --no-deps --pull never -T operator < "$smoke_directory/bootstrap.json"
organization=$(compose exec -T database psql -U postgres -d pipong -qAt -c "SELECT count(*) FROM auth.organizations WHERE slug='ci-installation'")
test "$organization" = 1
compose up -d --wait --wait-timeout 120 --no-build api worker
address=$(compose port api 3000)
curl --fail --silent --show-error -H "Authorization: Bearer $(cat "$PIPONG_SECRETS_DIR/diagnostics-token")" "http://$address/health/live"
for attempt in $(seq 1 30); do
  heartbeat=$(compose exec -T database psql -U postgres -d pipong -qAt -c 'SELECT count(*) FROM app.worker_heartbeats WHERE expires_at > now()')
  if [ "$heartbeat" -gt 0 ]; then
    break
  fi
  sleep 1
done
test "$heartbeat" -gt 0
compose stop api worker
heartbeat=$(compose exec -T database psql -U postgres -d pipong -qAt -c 'SELECT count(*) FROM app.worker_heartbeats')
test "$heartbeat" = 0
