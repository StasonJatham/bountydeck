#!/bin/sh
set -eu

mode=${1:?Usage: security-check.sh config|runtime|scan docker|podman [Compose options or image]}
engine=${2:?Set engine to docker or podman}
shift 2
case "$engine" in docker|podman) ;; *) exit 2 ;; esac

case "$mode" in
  config)
    config=$("$engine" compose "$@" config --format json)
    printf '%s\n' "$config" | jq -e '
      .networks.database.internal == true
      and ([.services | to_entries[] | select(.key != "reverse-proxy")
            | select((.value.ports // []) | length > 0)] | length == 0)
      and all(.services[];
        .privileged != true and .network_mode != "host" and .pid != "host"
        and .ipc != "host" and .userns_mode != "host"
        and ((.security_opt // []) | any(test("^no-new-privileges[:=]true$")))
        and ((.security_opt // []) | all(test("unconfined") | not))
        and ((.volumes // []) | all(
          (if type == "object" then (.source // "") else . end)
          | test("docker\\.sock|podman\\.sock|^/$") | not))
        and ((.image // "") | if startswith("bountydeck:") or . == env.BOUNTYDECK_IMAGE
          or . == "bountydeck-postgres:18.6-r1" or . == env.BOUNTYDECK_POSTGRES_IMAGE
          then true else test("@sha256:[0-9a-f]{64}$") end))
    '
    ;;
  runtime)
    "$(dirname "$0")/verify-network.sh" "$engine" "$@"
    containers=$("$engine" compose "$@" ps -q)
    # shellcheck disable=SC2086
    "$engine" inspect $containers | jq -e '
      all(.[];
        .HostConfig.Privileged != true
        and .HostConfig.NetworkMode != "host"
        and .HostConfig.PidMode != "host"
        and .HostConfig.IpcMode != "host"
        and .HostConfig.UsernsMode != "host"
        and ((.HostConfig.CapDrop // []) | any(ascii_upcase == "ALL"))
        and (.HostConfig.Memory // 0) > 0
        and (.HostConfig.PidsLimit // 0) > 0
        and ((.HostConfig.NanoCpus // 0) > 0 or (.HostConfig.CpuQuota // 0) > 0)
        and ((.HostConfig.Ulimits // []) | any((.Name // .name) == "nofile"))
        and (.HostConfig.ReadonlyRootfs == true
          or (.Config.Labels["com.docker.compose.service"] // .Config.Labels["io.podman.compose.service"]) == "keycloak")
        and ((.HostConfig.SecurityOpt // []) | any(test("^no-new-privileges([:=]true)?$")))
        and ((.HostConfig.SecurityOpt // []) | all(test("unconfined") | not))
        and ((.Mounts // []) | all((.Source // "") | test("docker\\.sock|podman\\.sock|^/$") | not)))
    '
    for service in application worker; do
      container=$("$engine" compose "$@" ps -q "$service")
      test -n "$container"
      "$engine" exec "$container" sh -ec '
        test "$(id -u)" -ne 0
        grep -Eq "^CapEff:[[:space:]]+0+$" /proc/1/status
        grep -Eq "^NoNewPrivs:[[:space:]]+1$" /proc/1/status
        grep -Eq "^Seccomp:[[:space:]]+2$" /proc/1/status
        test -w /tmp
        if touch /app/.security-check 2>/dev/null; then
          unlink /app/.security-check
          exit 1
        fi
      '
      printf '%s\n' "$service: unprivileged, no capabilities, read-only root"
    done
    ;;
  scan)
    image=${1:?Set image reference}
    command -v trivy >/dev/null
    scan_dir=$(mktemp -d)
    trap 'if [ -e "$scan_dir/image.tar" ]; then unlink "$scan_dir/image.tar"; fi; rmdir "$scan_dir"' EXIT
    "$engine" save -o "$scan_dir/image.tar" "$image"
    trivy image --input "$scan_dir/image.tar" --format cyclonedx --output "${SBOM_OUTPUT:-bountydeck.sbom.json}"
    trivy image --input "$scan_dir/image.tar" --scanners vuln,secret --severity HIGH,CRITICAL --exit-code 1
    ;;
  *) exit 2 ;;
esac
