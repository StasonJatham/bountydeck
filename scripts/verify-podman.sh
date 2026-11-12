#!/bin/sh
set -eu

podman info --format json |
  jq -e '.host.security.rootless and .host.cgroupVersion == "v2" and .host.cgroupManager == "systemd"' >/dev/null ||
  { echo "Select rootless Podman with cgroup v2 and systemd" >&2; exit 1; }
podman compose version
exec "$(dirname "$0")/security-check.sh" runtime podman "$@"
