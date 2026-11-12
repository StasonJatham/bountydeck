#!/bin/sh
set -eu

read_secret() {
  tr -d '\r\n' < "/run/secrets/$1"
}

database_url() {
  encoded=$(read_secret "$1" | node -e 'process.stdout.write(encodeURIComponent(require("node:fs").readFileSync(0, "utf8")))')
  database=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "${BOUNTYDECK_DATABASE:-bountydeck}")
  printf 'postgresql://%s:%s@postgres:5432/%s' "$2" "$encoded" "$database"
}

if [ -s /run/secrets/internal_ca ]; then
  export NODE_EXTRA_CA_CERTS=/run/secrets/internal_ca
fi

case "${BOUNTYDECK_SERVICE:-app}" in
  app)
    export DATABASE_URL="$(database_url db_app_password bossob_app)"
    export AUTH_SECRET="$(read_secret auth_secret)"
    export OIDC_CLIENT_SECRET="$(read_secret oidc_client_secret)"
    if [ -n "${INTEGRATION_AUDIENCE:-}" ]; then
      export INTEGRATION_INTROSPECTION_CLIENT_ID="${INTEGRATION_INTROSPECTION_CLIENT_ID:-$OIDC_CLIENT_ID}"
      if [ "$INTEGRATION_INTROSPECTION_CLIENT_ID" = "$OIDC_CLIENT_ID" ] &&
        [ -z "${INTEGRATION_INTROSPECTION_CLIENT_SECRET_FILE:-}" ]; then
        export INTEGRATION_INTROSPECTION_CLIENT_SECRET="$OIDC_CLIENT_SECRET"
      fi
    fi
    ;;
  worker)
    export WORKER_DATABASE_URL="$(database_url db_worker_password bossob_worker)"
    if [ -r /run/secrets/smtp_url ]; then
      export SMTP_URL="$(read_secret smtp_url)"
    fi
    ;;
  retention)
    export RETENTION_DATABASE_URL="$(database_url db_admin_password postgres)"
    ;;
  migrate)
    export MIGRATION_DATABASE_URL="$(database_url db_migrate_password bossob_migrate)"
    ;;
  *) printf 'Unknown BOUNTYDECK_SERVICE\n' >&2; exit 1 ;;
esac

exec "$@"
