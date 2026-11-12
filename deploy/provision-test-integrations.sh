#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(docker compose port reverse-proxy 80)" != "127.0.0.1:80" ||
      "$(docker compose port postgres 5432)" != "127.0.0.1:55432" ]]; then
  echo "This fixture requires the loopback-only example and deploy/compose.test.yaml." >&2
  exit 1
fi

umask 077
if [[ ! -s secrets/test_integration_service_secret ]]; then
  openssl rand -hex 32 > secrets/test_integration_service_secret
fi

service_subject=$(
  node --input-type=module <<'JS' | docker compose --profile keycloak exec -T keycloak bash -c '
    set -euo pipefail
    [[ "$KC_HOSTNAME" == "http://bountydeck.test/identity" ]]
    read -r scope_json
    read -r delegated_json
    read -r service_json
    read -r mapper_json
    read -r introspection_mapper_json
    config=$(mktemp)
    trap "unlink \"$config\"" EXIT
    kc() { /opt/keycloak/bin/kcadm.sh "$@" --config "$config"; }
    /opt/keycloak/bin/kcadm.sh config credentials --config "$config" --server http://localhost:8080/identity --realm master       --user bountydeck-bootstrap --password "$(cat /run/secrets/keycloak_admin_password)" >&2
    scope=
    while IFS=, read -r id name; do
      if [[ "$name" == "bountydeck.api" ]]; then scope=$id; break; fi
    done <<< "$(kc get client-scopes -r bountydeck --fields id,name --format csv --noquotes)"
    if [[ -z "$scope" ]]; then
      scope=$(printf "%s" "$scope_json" | kc create client-scopes -r bountydeck -i -f -)
    fi
    configure_mapper() {
      local mapper_name=$1 input=$2 id name base
      base="client-scopes/$scope/protocol-mappers/models"
      while IFS=, read -r id name; do
        if [[ "$name" == "$mapper_name" ]]; then
          printf "%s" "$input" | kc update "$base/$id" -r bountydeck -f - >&2
          return
        fi
      done <<< "$(kc get "$base" -r bountydeck --fields id,name --format csv --noquotes)"
      printf "%s" "$input" | kc create "$base" -r bountydeck -f - >&2
    }
    configure_mapper "BountyDeck API audience" "$mapper_json"
    configure_mapper "BountyDeck introspection audience" "$introspection_mapper_json"
    bind_client() {
      local client_id=$1 input=$2 client
      client=$(kc get clients -r bountydeck -q "clientId=$client_id" --fields id --format csv --noquotes | tail -1)
      if [[ -z "$client" ]]; then
        client=$(printf "%s" "$input" | kc create clients -r bountydeck -i -f -)
      fi
      kc update "clients/$client/default-client-scopes/$scope" -r bountydeck -n >&2
      printf "%s" "$client"
    }
    bind_client bountydeck-fixture-delegated "$delegated_json" >/dev/null
    service=$(bind_client bountydeck-fixture-service "$service_json")
    kc get "clients/$service/service-account-user" -r bountydeck --fields id --format csv --noquotes | tail -1
  '
import { readFileSync } from "node:fs";

const mapper = {
  name: "BountyDeck API audience",
  protocol: "openid-connect",
  protocolMapper: "oidc-audience-mapper",
  config: { "included.custom.audience": "http://bountydeck.test/mcp", "id.token.claim": "false", "access.token.claim": "true", "introspection.token.claim": "true" },
};
console.log(JSON.stringify({
  name: "bountydeck.api",
  protocol: "openid-connect",
  attributes: { "include.in.token.scope": "true" },
}));
console.log(JSON.stringify({
  clientId: "bountydeck-fixture-delegated",
  enabled: true,
  protocol: "openid-connect",
  publicClient: true,
  standardFlowEnabled: true,
  directAccessGrantsEnabled: false,
  redirectUris: ["http://127.0.0.1:8765/callback"],
  attributes: { "pkce.code.challenge.method": "S256" },
}));
console.log(JSON.stringify({
  clientId: "bountydeck-fixture-service",
  enabled: true,
  protocol: "openid-connect",
  publicClient: false,
  secret: readFileSync("secrets/test_integration_service_secret", "utf8").trim(),
  standardFlowEnabled: false,
  directAccessGrantsEnabled: false,
  serviceAccountsEnabled: true,
}));
console.log(JSON.stringify(mapper));
console.log(JSON.stringify({
  ...mapper,
  name: "BountyDeck introspection audience",
  config: { "included.client.audience": "bountydeck", "id.token.claim": "false", "access.token.claim": "true", "introspection.token.claim": "true" },
}));
JS
)
[[ "$service_subject" =~ ^[a-f0-9-]{36}$ ]]
node --input-type=module -e 'console.log(JSON.stringify({"bountydeck-fixture-service":process.argv[1]}))'   "$service_subject" > secrets/test_integration_service_binding

issuer=http://bountydeck.test/identity/realms/bountydeck
organization=00000000-0000-4000-8000-000000000001
program=00000000-0000-4000-8000-000000000011
admin=$(docker compose exec -T postgres psql -U postgres -d bountydeck -Atc "
  SELECT user_id FROM accounts
  WHERE provider = 'oidc:$issuer'
    AND provider_account_id = '00000000-0000-4000-8000-000000000105'")
[[ "$admin" =~ ^[a-f0-9-]{36}$ ]]
migrate_password=$(cat secrets/db_migrate_password)
actor=$(MIGRATION_DATABASE_URL="postgresql://bossob_migrate:$migrate_password@127.0.0.1:55432/bountydeck"   node db/provision-integration.ts "$issuer" "$service_subject" "Fixture automation" "$organization" "$admin")
[[ "$actor" =~ ^[a-f0-9-]{36}$ ]]
docker compose exec -T postgres psql -U postgres -d bountydeck -v ON_ERROR_STOP=1 -q   -c "INSERT INTO program_memberships (program_id, user_id, role) VALUES ('$program', '$actor', 'triager') ON CONFLICT DO NOTHING"
printf '%s\n' "$actor" > secrets/test_integration_service_actor
echo "Loopback OAuth fixtures provisioned"
