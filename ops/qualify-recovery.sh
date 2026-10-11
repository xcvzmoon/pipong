#!/bin/sh
set -eu
recovery_tag="$(date +%Y%m%d%H%M%S)-$$"
recovery_build="pipong-recovery-build:$recovery_tag"
recovery_image="pipong-recovery:$recovery_tag"
recovery_container="pipong-recovery-$recovery_tag"
recovery_directory="${RECOVERY_REPORT_DIR:-/tmp/pipong-recovery-$recovery_tag}"
mkdir "$recovery_directory"
recovery_completed=false
cleanup() {
  recovery_result=$?
  if [ "$recovery_result" -eq 0 ] && [ "$recovery_completed" != true ]; then
    recovery_result=1
  fi
  trap - EXIT
  set +e
  if docker container inspect "$recovery_container" > /dev/null 2>&1; then
    docker inspect --format 'OOMKilled={{.State.OOMKilled}} Memory={{.HostConfig.Memory}} MemorySwap={{.HostConfig.MemorySwap}} NanoCpus={{.HostConfig.NanoCpus}} CpusetCpus={{.HostConfig.CpusetCpus}}' "$recovery_container" >> "$recovery_directory/environment.txt"
    docker exec "$recovery_container" sh -c 'cat /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.events /sys/fs/cgroup/cpu.stat' > "$recovery_directory/resources.txt"
    docker stop --time 15 "$recovery_container" > /dev/null 2>&1
    docker rm --force "$recovery_container" > /dev/null
  fi
  docker image rm "$recovery_image" "$recovery_build" > /dev/null 2>&1
  printf 'ExitStatus=%s\n' "$recovery_result" >> "$recovery_directory/environment.txt"
  printf 'Recovery evidence: %s\n' "$recovery_directory"
  exit "$recovery_result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
{
  date -u '+RunUTC=%Y-%m-%dT%H:%M:%SZ'
  printf 'SourceCommit=%s\n' "$(git rev-parse HEAD)"
  printf 'LockfileSHA256=%s\n' "$(shasum -a 256 pnpm-lock.yaml | cut -d ' ' -f 1)"
  git status --short
  docker info --format 'DockerCPUs={{.NCPU}} DockerMemory={{.MemTotal}} Architecture={{.Architecture}}'
} > "$recovery_directory/environment.txt"
git diff --binary > "$recovery_directory/source.patch"
cp ops/qualify-recovery.sh "$recovery_directory/qualify-recovery.sh"
docker build --resource memory=2g --resource memory-swap=2g --resource cpu-quota=200000 --resource cpu-period=100000 --resource cpuset-cpus=0,1 \
  --target build --tag "$recovery_build" . > "$recovery_directory/build.txt" 2>&1
docker build --resource memory=2g --resource memory-swap=2g --resource cpu-quota=200000 --resource cpu-period=100000 --resource cpuset-cpus=0,1 \
  --file ops/qualification.Dockerfile --build-arg "BUILD_IMAGE=$recovery_build" --tag "$recovery_image" . >> "$recovery_directory/build.txt" 2>&1
docker image inspect --format 'Image={{.Id}} Platform={{.Os}}/{{.Architecture}}' "$recovery_image" >> "$recovery_directory/environment.txt"
docker create --name "$recovery_container" --cpus 2 --cpuset-cpus 0,1 --memory 2g --memory-swap 2g \
  --network none "$recovery_image" > /dev/null
docker start "$recovery_container" > /dev/null
recovery_ready=false
for recovery_attempt in $(seq 1 60); do
  if docker exec "$recovery_container" pg_isready --host 127.0.0.1 --username postgres > /dev/null 2>&1; then
    recovery_ready=true
    break
  fi
  sleep 1
done
if [ "$recovery_ready" != true ]; then
  docker logs "$recovery_container" > "$recovery_directory/database.txt" 2>&1
  printf 'RECOVERY_DATABASE_START_FAILED\n' >&2
  exit 1
fi
docker exec "$recovery_container" sh -c 'node --version; pnpm --version; postgres --version; node -p '\''JSON.parse(require("node:fs").readFileSync("apps/server/node_modules/nitro/package.json", "utf8")).version'\''' >> "$recovery_directory/environment.txt"
if ! docker exec "$recovery_container" sh -c 'export PATH="/usr/lib/postgresql/18/bin:$PATH"; export TEST_AUTH_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres; pnpm server test tests/restore.integration.test.ts --no-file-parallelism --silent=false' > "$recovery_directory/runtime.txt" 2>&1; then
  cat "$recovery_directory/runtime.txt" >&2
  exit 1
fi
cat "$recovery_directory/runtime.txt"
if ! docker exec "$recovery_container" sh -c 'export PATH="/usr/lib/postgresql/18/bin:$PATH"; export TEST_WAL_RECOVERY=1; export TEST_AUTH_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres; pnpm server test tests/restore.integration.test.ts --no-file-parallelism --silent=false' > "$recovery_directory/application-wal.txt" 2>&1; then
  cat "$recovery_directory/application-wal.txt" >&2
  exit 1
fi
cat "$recovery_directory/application-wal.txt"
if ! docker exec "$recovery_container" sh -c 'export PATH="/usr/lib/postgresql/18/bin:$PATH"; export TEST_AUTH_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres; pnpm server test tests/credentials.integration.test.ts tests/service-keys.integration.test.ts --no-file-parallelism --silent=false' > "$recovery_directory/incidents.txt" 2>&1; then
  cat "$recovery_directory/incidents.txt" >&2
  exit 1
fi
cat "$recovery_directory/incidents.txt"
if ! docker exec "$recovery_container" sh -c 'export PATH="/usr/lib/postgresql/18/bin:$PATH"; sh ops/check-wal-recovery.sh' > "$recovery_directory/wal.txt" 2>&1; then
  cat "$recovery_directory/wal.txt" >&2
  exit 1
fi
cat "$recovery_directory/wal.txt"
docker exec "$recovery_container" sh -c 'test "$(cat /sys/fs/cgroup/memory.events | awk '\''$1 == "oom" || $1 == "oom_kill" || $1 == "max" { total += $2 } END { print total + 0 }'\'')" = 0'
recovery_completed=true
printf 'Constrained Linux logical/application-WAL recovery and focused incident checks passed.\n'
