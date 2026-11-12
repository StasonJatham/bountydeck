#!/bin/sh
set -eu

scratch=$(mktemp -d)
cleanup() {
  for path in "$scratch"/secrets/*; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      unlink "$path"
    fi
  done
  unlink "$scratch/deploy/init-secrets.sh"
  rmdir "$scratch/deploy" "$scratch/secrets" "$scratch"
}
trap cleanup EXIT
mkdir "$scratch/deploy" "$scratch/secrets"
cp "$(dirname "$0")/init-secrets.sh" "$scratch/deploy/"

sh "$scratch/deploy/init-secrets.sh"
test -s "$scratch/secrets/db_app_password"
test ! -s "$scratch/secrets/oidc_client_secret"
before=$(cksum "$scratch/secrets/db_app_password")
sh "$scratch/deploy/init-secrets.sh" keycloak
test -s "$scratch/secrets/oidc_client_secret"
test "$(cksum "$scratch/secrets/db_app_password")" = "$before"

unrelated="$scratch/secrets/db_backup"
touch "$unrelated"
chmod 0600 "$unrelated"
sh "$scratch/deploy/init-secrets.sh" keycloak
test "$(LC_ALL=C ls -ld "$unrelated" | cut -c 1-10)" = "-rw-------"

unlink "$scratch/secrets/smtp_url"
ln -s "$unrelated" "$scratch/secrets/smtp_url"
if sh "$scratch/deploy/init-secrets.sh" keycloak >/dev/null 2>&1; then
  printf 'Initialization accepted a symlink at a secret path.\n' >&2
  exit 1
fi
test -L "$scratch/secrets/smtp_url"
test "$(LC_ALL=C ls -ld "$unrelated" | cut -c 1-10)" = "-rw-------"
