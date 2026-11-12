#!/bin/bash
set -eu

require_secret() {
  local value
  value=$(cat "/run/secrets/$1") || return 1
  if [[ -z "$value" ]]; then
    printf 'Required secret is empty: %s.\n' "$1" >&2
    return 1
  fi
  printf '%s' "$value"
}

KC_DB_PASSWORD="$(require_secret db_keycloak_password)"
BOUNTYDECK_OIDC_CLIENT_SECRET="$(require_secret oidc_client_secret)"
export KC_DB_PASSWORD BOUNTYDECK_OIDC_CLIENT_SECRET
if [[ -s /run/secrets/keycloak_admin_password ]]; then
  KC_BOOTSTRAP_ADMIN_PASSWORD="$(require_secret keycloak_admin_password)"
  export KC_BOOTSTRAP_ADMIN_PASSWORD
fi
exec /opt/keycloak/bin/kc.sh start --import-realm
