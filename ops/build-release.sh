#!/bin/sh
set -eu
: "${PIPONG_VERSION:?Set PIPONG_VERSION to the version shown by the release dry run}"
for artifact in server worker migrate database; do
  docker build --target "$artifact" --tag "pipong-$artifact:$PIPONG_VERSION" .
done
