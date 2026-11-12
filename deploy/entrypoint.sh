#!/bin/sh
set -eu

read_secret() {
  tr -d '\r\n' < "/run/secrets/$1"
}

require_secret() {
  value=$(read_secret "$1") || return 1
  if [ -z "$value" ]; then
    printf 'Required secret is empty: %s.\n' "$1" >&2
    return 1
  fi
  printf '%s' "$value"
}

database_url() {
  value=$(require_secret "$1") || return 1
  encoded=$(printf '%s' "$value" | node -e 'process.stdout.write(encodeURIComponent(require("node:fs").readFileSync(0, "utf8")))')
  database=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "${BOUNTYDECK_DATABASE:-bountydeck}")
  printf 'postgresql://%s:%s@postgres:5432/%s' "$2" "$encoded" "$database"
}

if [ -s /run/secrets/internal_ca ]; then
  export NODE_EXTRA_CA_CERTS=/run/secrets/internal_ca
fi

case "${BOUNTYDECK_SERVICE:-app}" in
  app)
    DATABASE_URL="$(database_url db_app_password bossob_app)"
    export DATABASE_URL
    require_secret auth_secret >/dev/null
    require_secret oidc_client_secret >/dev/null
    export AUTH_SECRET_FILE=/run/secrets/auth_secret
    export OIDC_CLIENT_SECRET_FILE=/run/secrets/oidc_client_secret
    if [ -n "${INTEGRATION_AUDIENCE:-}" ]; then
      export INTEGRATION_INTROSPECTION_CLIENT_ID="${INTEGRATION_INTROSPECTION_CLIENT_ID:-$OIDC_CLIENT_ID}"
      if [ "$INTEGRATION_INTROSPECTION_CLIENT_ID" = "$OIDC_CLIENT_ID" ] &&
        [ -z "${INTEGRATION_INTROSPECTION_CLIENT_SECRET_FILE:-}" ]; then
        export INTEGRATION_INTROSPECTION_CLIENT_SECRET_FILE="$OIDC_CLIENT_SECRET_FILE"
      fi
    fi
    ;;
  worker)
    WORKER_DATABASE_URL="$(database_url db_worker_password bossob_worker)"
    export WORKER_DATABASE_URL
    if [ -r /run/secrets/smtp_url ]; then
      SMTP_URL="$(read_secret smtp_url)"
      export SMTP_URL
    fi
    ;;
  retention)
    RETENTION_DATABASE_URL="$(database_url db_admin_password postgres)"
    export RETENTION_DATABASE_URL
    ;;
  migrate)
    MIGRATION_DATABASE_URL="$(database_url db_migrate_password bossob_migrate)"
    export MIGRATION_DATABASE_URL
    ;;
  *) printf 'Unknown BOUNTYDECK_SERVICE\n' >&2; exit 1 ;;
esac

exec "$@"
