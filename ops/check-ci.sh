#!/bin/sh
set -eu
: "${CI_DATABASE_URL:?Set CI_DATABASE_URL to a disposable PostgreSQL 18 trust-authenticated cluster}"
export TEST_DATABASE_URL="$CI_DATABASE_URL"
export TEST_ADMISSION_DATABASE_URL="$CI_DATABASE_URL"
export TEST_AUTH_DATABASE_URL="$CI_DATABASE_URL"
export TEST_DELIVERY_DATABASE_URL="$CI_DATABASE_URL"
pnpm check
pnpm database check
pnpm build
pnpm --recursive --workspace-concurrency=1 --if-present run test --no-file-parallelism
