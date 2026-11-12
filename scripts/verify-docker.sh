#!/bin/sh
set -eu

docker info --format '{{json .SecurityOptions}}' |
  jq -e 'any(.[]; contains("rootless"))' >/dev/null ||
  { echo "The selected Docker context does not use a rootless daemon" >&2; exit 1; }
docker info --format '{{.CgroupVersion}} {{.CgroupDriver}}' |
  grep -qx '2 systemd' ||
  { echo "Rootless resource controls require cgroup v2 with systemd" >&2; exit 1; }
docker compose version
exec "$(dirname "$0")/security-check.sh" runtime docker "$@"
