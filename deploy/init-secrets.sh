#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077

required="db_admin_password db_app_password db_worker_password db_migrate_password auth_secret"
identity="db_keycloak_password keycloak_admin_password oidc_client_secret"
optional="smtp_url internal_ca.pem"
case "${1:-}" in
  keycloak) required="$required $identity" ;;
  '') optional="$optional $identity" ;;
  *) printf 'Usage: %s [keycloak]\n' "$0" >&2; exit 1 ;;
esac
if [ "$#" -gt 1 ]; then
  printf 'Usage: %s [keycloak]\n' "$0" >&2
  exit 1
fi

if [ -L secrets ]; then
  printf 'The secrets directory must not be a symbolic link.\n' >&2
  exit 1
fi
mkdir -p secrets
chmod 0700 secrets

for name in $required $optional; do
  path="secrets/$name"
  if [ -L "$path" ] || { [ -e "$path" ] && [ ! -f "$path" ]; }; then
    printf 'Expected a regular secret file at %s.\n' "$path" >&2
    exit 1
  fi
done

generate() {
  temp=$(mktemp secrets/.new.XXXXXX)
  trap 'rm -f "$temp"' EXIT
  openssl rand -hex 32 > "$temp"
  mv -f "$temp" "secrets/$1"
  trap - EXIT
}

for name in $required; do
  if [ ! -s "secrets/$name" ]; then
    generate "$name"
  fi
done

for name in $optional; do
  if [ ! -e "secrets/$name" ]; then
    : > "secrets/$name"
  fi
done

# File-backed Compose secrets are bind mounts. Service UIDs differ and
# the private directory keeps these readable only by the host deploy user.
for name in $required $optional; do
  chmod 0444 "secrets/$name"
done
