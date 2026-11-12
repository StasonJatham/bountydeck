#!/bin/sh
set -eu

read_secret() {
  tr -d '\r\n' < "/run/secrets/$1"
}

database_url() {
  encoded=$(read_secret "$1" | node -e 'process.stdout.write(encodeURIComponent(require("node:fs").readFileSync(0, "utf8")))')
  printf 'postgresql://%s:%s@postgres:5432/bossob' "$2" "$encoded"
}

if [ -s /run/secrets/internal_ca ]; then
  export NODE_EXTRA_CA_CERTS=/run/secrets/internal_ca
fi

case "${BOSSOB_SERVICE:-app}" in
  app)
    export DATABASE_URL="$(database_url db_app_password bossob_app)"
    export AUTH_SECRET="$(read_secret auth_secret)"
    export OIDC_CLIENT_SECRET="$(read_secret oidc_client_secret)"
    ;;
  worker)
    export WORKER_DATABASE_URL="$(database_url db_worker_password bossob_worker)"
    if [ -r /run/secrets/smtp_url ]; then
      export SMTP_URL="$(read_secret smtp_url)"
    fi
    ;;
  migrate)
    export MIGRATION_DATABASE_URL="$(database_url db_migrate_password bossob_migrate)"
    ;;
  *) printf 'Unknown BOSSOB_SERVICE\n' >&2; exit 1 ;;
esac

exec "$@"
