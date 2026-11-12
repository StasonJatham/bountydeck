#!/bin/bash
set -eu
export KC_DB_PASSWORD="$(cat /run/secrets/db_keycloak_password)"
export KC_BOOTSTRAP_ADMIN_PASSWORD="$(cat /run/secrets/keycloak_admin_password)"
export BOSSOB_OIDC_CLIENT_SECRET="$(cat /run/secrets/oidc_client_secret)"
exec /opt/keycloak/bin/kc.sh start --import-realm
