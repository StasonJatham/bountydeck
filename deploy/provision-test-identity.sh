#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# This realm data is only for the loopback Compose example.
if [[ "$(docker compose port reverse-proxy 80)" != "127.0.0.1:80" ]]; then
  echo "The test identity script requires the loopback-only Compose deployment." >&2
  exit 1
fi

umask 077
if [[ ! -s secrets/test_user_password ]]; then
  openssl rand -hex 24 > secrets/test_user_password
fi

node --input-type=commonjs <<'JS' | docker compose --profile keycloak exec -T keycloak bash -c '
  set -euo pipefail
  if [[ "$KC_HOSTNAME" != "http://bossob.test/identity" ]]; then
    echo "Expected the local Keycloak test issuer." >&2
    exit 1
  fi
  config=$(mktemp)
  trap "rm -f \"$config\"" EXIT
  kcadm=/opt/keycloak/bin/kcadm.sh
  "$kcadm" config credentials --config "$config" --server http://localhost:8080/identity \
    --realm master --user bossob-bootstrap --password "$(cat /run/secrets/keycloak_admin_password)"
  "$kcadm" create partialImport --config "$config" -r bossob -f -
'
const { readFileSync } = require("node:fs");
const password = readFileSync("secrets/test_user_password", "utf8").trim();
const roles = ["researcher", "triager", "manager", "outsider", "platform-admin"];
const users = roles.map((role, index) => {
  const username = `local-${role}`;
  return {
    id: `00000000-0000-4000-8000-${String(101 + index).padStart(12, "0")}`,
    username,
    enabled: true,
    email: `${username}@example.invalid`,
    firstName: "Local",
    lastName: role,
    credentials: [{ type: "password", value: password, temporary: false }],
  };
});
process.stdout.write(JSON.stringify({ ifResourceExists: "SKIP", users }));
JS
