#!/bin/sh
set -eu

export BOSSOB_APP_PASSWORD="$(cat /run/secrets/db_app_password)"
export BOSSOB_MIGRATE_PASSWORD="$(cat /run/secrets/db_migrate_password)"
export BOSSOB_WORKER_PASSWORD="$(cat /run/secrets/db_worker_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv app_password BOSSOB_APP_PASSWORD
\getenv migrate_password BOSSOB_MIGRATE_PASSWORD
\getenv worker_password BOSSOB_WORKER_PASSWORD
CREATE ROLE bossob_app LOGIN PASSWORD :'app_password';
CREATE ROLE bossob_migrate LOGIN PASSWORD :'migrate_password';
CREATE ROLE bossob_worker LOGIN PASSWORD :'worker_password';
CREATE DATABASE bossob OWNER bossob_migrate;
REVOKE ALL ON DATABASE bossob FROM PUBLIC;
GRANT CONNECT ON DATABASE bossob TO bossob_app, bossob_worker;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
SQL

if [ -s /run/secrets/db_keycloak_password ]; then
  export BOSSOB_KEYCLOAK_PASSWORD="$(cat /run/secrets/db_keycloak_password)"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv keycloak_password BOSSOB_KEYCLOAK_PASSWORD
CREATE ROLE bossob_keycloak LOGIN PASSWORD :'keycloak_password';
CREATE DATABASE keycloak OWNER bossob_keycloak;
REVOKE ALL ON DATABASE keycloak FROM PUBLIC;
SQL
fi
