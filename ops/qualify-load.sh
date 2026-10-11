#!/bin/sh
set -eu
qualification_tag="$(date +%Y%m%d%H%M%S)-$$"
qualification_build="pipong-qualification-build:$qualification_tag"
qualification_image="pipong-qualification:$qualification_tag"
qualification_container="pipong-qualification-$qualification_tag"
qualification_report="${QUALIFICATION_REPORT:-/tmp/pipong-qualification-$qualification_tag.json}"
qualification_cpu="${QUALIFICATION_CPUS:-2}"
qualification_cpuset="${QUALIFICATION_CPUSET:-0,1}"
qualification_memory="${QUALIFICATION_MEMORY:-2g}"
qualification_cpu_quota="$(awk -v cpus="$qualification_cpu" 'BEGIN { if (cpus <= 0) { exit 1 }; printf "%.0f", cpus * 100000 }')"
qualification_created=false
cleanup() {
  qualification_providers="$(docker ps --all --quiet --filter "label=pipong.qualification.backend=$qualification_container" || true)"
  for qualification_provider in $qualification_providers; do
    docker rm --force "$qualification_provider" > /dev/null 2>&1 || true
  done
  if [ -f "$qualification_report" ]; then
    printf 'Qualification report: %s\n' "$qualification_report"
  fi
  if [ "$qualification_created" = true ]; then
    docker stop --time 15 "$qualification_container" > /dev/null 2>&1 || true
    docker rm --force "$qualification_container" > /dev/null
  fi
  docker image rm "$qualification_image" "$qualification_build" > /dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker build --resource "memory=$qualification_memory" --resource "memory-swap=$qualification_memory" \
  --resource "cpu-quota=$qualification_cpu_quota" --resource cpu-period=100000 --resource "cpuset-cpus=$qualification_cpuset" \
  --target build --tag "$qualification_build" .
docker build --resource "memory=$qualification_memory" --resource "memory-swap=$qualification_memory" \
  --resource "cpu-quota=$qualification_cpu_quota" --resource cpu-period=100000 --resource "cpuset-cpus=$qualification_cpuset" \
  --file ops/qualification.Dockerfile --build-arg "BUILD_IMAGE=$qualification_build" --tag "$qualification_image" .
docker create --name "$qualification_container" --cpus "$qualification_cpu" --cpuset-cpus "$qualification_cpuset" --memory "$qualification_memory" --memory-swap "$qualification_memory" \
  --publish 127.0.0.1::5432 --publish 127.0.0.1::3000 --publish 127.0.0.1::3001 \
  --add-host host.docker.internal:host-gateway "$qualification_image" > /dev/null
qualification_created=true
docker start "$qualification_container" > /dev/null
qualification_ready=false
for qualification_attempt in $(seq 1 60); do
  if docker exec "$qualification_container" pg_isready --host 127.0.0.1 --username postgres > /dev/null 2>&1; then
    qualification_ready=true
    break
  fi
  sleep 1
done
if [ "$qualification_ready" != true ]; then
  docker logs "$qualification_container" >&2
  printf 'QUALIFICATION_DATABASE_START_FAILED: PostgreSQL did not become ready.\n' >&2
  exit 1
fi
qualification_database_port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$qualification_container")"
qualification_api_port_1="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "$qualification_container")"
qualification_api_port_2="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3001/tcp") 0).HostPort}}' "$qualification_container")"
QUALIFICATION_CONTAINER="$qualification_container" \
QUALIFICATION_DATABASE_URL="postgres://postgres@127.0.0.1:$qualification_database_port/postgres" \
QUALIFICATION_API_URL_1="http://localhost:$qualification_api_port_1" \
QUALIFICATION_API_URL_2="http://localhost:$qualification_api_port_2" \
QUALIFICATION_SECONDS="${QUALIFICATION_SECONDS:-1800}" \
QUALIFICATION_RETAINED_JOBS="${QUALIFICATION_RETAINED_JOBS:-150000}" \
QUALIFICATION_CPU_LIMIT="$qualification_cpu" \
QUALIFICATION_MEMORY_LIMIT="$qualification_memory" \
QUALIFICATION_REPORT="$qualification_report" \
pnpm server test load-qualification --no-file-parallelism
