#!/bin/sh
set -eu
install -o postgres -g postgres -m 0600 /run/secrets/database-key /tmp/database.key
exec /usr/local/bin/docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/run/secrets/database-cert -c ssl_key_file=/tmp/database.key
