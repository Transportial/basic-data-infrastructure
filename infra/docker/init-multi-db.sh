#!/bin/sh
set -eu

# Creates the three service-specific databases on first boot. Invoked by the
# Postgres image's /docker-entrypoint-initdb.d hook.
for db in asr_db ors_db con_db; do
  echo "Creating database $db"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-SQL
    CREATE DATABASE $db;
    GRANT ALL PRIVILEGES ON DATABASE $db TO $POSTGRES_USER;
SQL
done
