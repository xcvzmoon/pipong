#!/bin/sh
set -eu
wal_port=${PIPONG_WAL_PORT:-55442}
case "$wal_port" in
  ''|*[!0-9]*) printf '%s\n' 'WAL_DRILL_PORT_INVALID' >&2; exit 1 ;;
esac
case "$(postgres --version)" in
  *' 18.'*) ;;
  *) printf '%s\n' 'WAL_DRILL_REQUIRES_POSTGRESQL_18' >&2; exit 1 ;;
esac
wal_directory=$(mktemp -d /tmp/pipong-wal-XXXXXXXX)
cleanup() {
  result=$?
  trap - EXIT
  set +e
  pg_ctl -D "$wal_directory/source" -m immediate -w stop >/dev/null 2>&1
  pg_ctl -D "$wal_directory/restored" -m immediate -w stop >/dev/null 2>&1
  if [ "$result" -ne 0 ]; then
    cat "$wal_directory/source.log" "$wal_directory/restored.log" >&2
  fi
  rm -rf "$wal_directory"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$wal_directory/archive" "$wal_directory/socket"
initdb -D "$wal_directory/source" -U postgres --encoding=UTF8 --locale=C --auth=trust >/dev/null
cat >> "$wal_directory/source/postgresql.conf" <<CONF
listen_addresses = '127.0.0.1'
port = $wal_port
unix_socket_directories = '$wal_directory/socket'
wal_level = replica
archive_mode = on
archive_command = 'test ! -f $wal_directory/archive/%f && cp %p $wal_directory/archive/%f'
CONF
pg_ctl -D "$wal_directory/source" -l "$wal_directory/source.log" -w start >/dev/null
sql() {
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$wal_port" -U postgres -d postgres "$@"
}
sql -q -c "CREATE TABLE recovery_markers (name text PRIMARY KEY, committed_at timestamptz NOT NULL DEFAULT clock_timestamp()); INSERT INTO recovery_markers (name) VALUES ('before_snapshot')"
pg_basebackup -h 127.0.0.1 -p "$wal_port" -U postgres -D "$wal_directory/restored" --checkpoint=fast --wal-method=stream >/dev/null
pg_verifybackup "$wal_directory/restored" >/dev/null
sql -q -c "INSERT INTO recovery_markers (name) VALUES ('post_snapshot_revocation'), ('post_snapshot_erasure')" >/dev/null
sql -q -c "SELECT pg_create_restore_point('pipong_incident_target')" >/dev/null
sql -q -c "INSERT INTO recovery_markers (name) VALUES ('after_target')" >/dev/null
sql -q -c "SELECT pg_switch_wal()" >/dev/null
wal_wait=0
while [ "$(sql -At -c 'SELECT archived_count FROM pg_stat_archiver')" -lt 2 ]; do
  wal_wait=$((wal_wait + 1))
  if [ "$wal_wait" -ge 60 ]; then
    printf '%s\n' 'WAL_DRILL_ARCHIVE_TIMEOUT' >&2
    exit 1
  fi
  sleep 1
done
loss_window_ms=$(sql -At -c "SELECT ceil(extract(epoch FROM clock_timestamp()-committed_at)*1000)::bigint FROM recovery_markers WHERE name='post_snapshot_erasure'")
pg_ctl -D "$wal_directory/source" -m immediate -w stop >/dev/null
recovery_started=$(perl -MTime::HiRes=time -e 'printf "%.0f", time*1000')
cat >> "$wal_directory/restored/postgresql.conf" <<CONF
archive_mode = off
restore_command = 'cp $wal_directory/archive/%f %p'
recovery_target_name = 'pipong_incident_target'
recovery_target_action = 'promote'
CONF
touch "$wal_directory/restored/recovery.signal"
pg_ctl -D "$wal_directory/restored" -l "$wal_directory/restored.log" -w start >/dev/null
recovery_wait=0
while [ "$(sql -At -c 'SELECT pg_is_in_recovery()')" != f ]; do
  recovery_wait=$((recovery_wait + 1))
  if [ "$recovery_wait" -ge 60 ]; then
    printf '%s\n' 'WAL_DRILL_PROMOTION_TIMEOUT' >&2
    exit 1
  fi
  sleep 1
done
recovered=$(sql -At -c 'SELECT string_agg(name, chr(44) ORDER BY name) FROM recovery_markers')
if [ "$recovered" != before_snapshot,post_snapshot_erasure,post_snapshot_revocation ]; then
  printf '%s\n' 'WAL_DRILL_MARKER_MISMATCH' >&2
  exit 1
fi
recovery_finished=$(perl -MTime::HiRes=time -e 'printf "%.0f", time*1000')
printf 'WAL reference fixture: PostgreSQL %s; recovery %s ms; conservative target loss window %s ms; 3 recovered markers; 1 later marker excluded; backup manifest verified\n' "$(postgres --version)" "$((recovery_finished - recovery_started))" "$loss_window_ms"
