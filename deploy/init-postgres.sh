#!/bin/sh
set -eu

export BOUNTYDECK_APP_PASSWORD="$(cat /run/secrets/db_app_password)"
export BOUNTYDECK_MIGRATE_PASSWORD="$(cat /run/secrets/db_migrate_password)"
export BOUNTYDECK_WORKER_PASSWORD="$(cat /run/secrets/db_worker_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres --set="application_db=${BOUNTYDECK_DATABASE:-bountydeck}" <<'SQL'
\getenv app_password BOUNTYDECK_APP_PASSWORD
\getenv migrate_password BOUNTYDECK_MIGRATE_PASSWORD
\getenv worker_password BOUNTYDECK_WORKER_PASSWORD
CREATE ROLE bossob_app LOGIN PASSWORD :'app_password';
CREATE ROLE bossob_migrate LOGIN PASSWORD :'migrate_password';
CREATE ROLE bossob_worker LOGIN PASSWORD :'worker_password';
CREATE DATABASE :"application_db" OWNER bossob_migrate;
REVOKE ALL ON DATABASE :"application_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"application_db" TO bossob_app, bossob_worker;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
SQL

if [ -s /run/secrets/db_keycloak_password ]; then
  export BOUNTYDECK_KEYCLOAK_PASSWORD="$(cat /run/secrets/db_keycloak_password)"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv keycloak_password BOUNTYDECK_KEYCLOAK_PASSWORD
CREATE ROLE bossob_keycloak LOGIN PASSWORD :'keycloak_password';
CREATE DATABASE keycloak OWNER bossob_keycloak;
REVOKE ALL ON DATABASE keycloak FROM PUBLIC;
SQL
fi
