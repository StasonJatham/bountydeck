#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
mkdir -p secrets
chmod 0700 secrets

generate() {
  temp=$(mktemp secrets/.new.XXXXXX)
  trap 'rm -f "$temp"' EXIT
  openssl rand -hex 32 > "$temp"
  mv -f "$temp" "secrets/$1"
  trap - EXIT
}

for name in db_admin_password db_app_password db_worker_password db_migrate_password auth_secret; do
  if [ ! -e "secrets/$name" ]; then
    generate "$name"
  fi
done

case "${1:-}" in
  keycloak)
    for name in db_keycloak_password keycloak_admin_password oidc_client_secret; do
      if [ ! -s "secrets/$name" ]; then
        generate "$name"
      fi
    done
    ;;
  '') ;;
  *) printf 'Usage: %s [keycloak]\n' "$0" >&2; exit 1 ;;
esac

touch secrets/db_keycloak_password secrets/keycloak_admin_password secrets/oidc_client_secret secrets/smtp_url secrets/internal_ca.pem
# Bind-mounted secrets must be readable by the different service UIDs.
# On the host the enclosing directory limits access to the deploy user.
chmod 0444 secrets/db_* secrets/keycloak_admin_password secrets/auth_secret \
  secrets/oidc_client_secret secrets/smtp_url secrets/internal_ca.pem
