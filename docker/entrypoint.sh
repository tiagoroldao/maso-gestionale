#!/bin/sh
set -e

# Bring the database schema up to date before starting (ADR 0005).
node ace migration:run --force --no-schema-generate

exec "$@"
