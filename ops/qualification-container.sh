#!/bin/sh
set -eu
export PATH="/usr/lib/postgresql/18/bin:$PATH"
qualification_database=/tmp/pipong-qualification-database
initdb -D "$qualification_database" --auth=trust --encoding=UTF8 --locale=C.UTF-8
printf 'host all all 0.0.0.0/0 trust\n' >> "$qualification_database/pg_hba.conf"
exec postgres -D "$qualification_database" -h 0.0.0.0 \
  -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=all
