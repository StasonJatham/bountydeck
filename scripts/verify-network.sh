#!/bin/sh
set -eu

engine=${1:?Usage: verify-network.sh docker|podman [Compose options]}
shift
case "$engine" in docker|podman) ;; *) exit 2 ;; esac

# Verify actual published ports rather than the image's EXPOSE metadata.
containers=$("$engine" compose "$@" ps -q)
test -n "$containers" || { echo "No running Compose containers found" >&2; exit 1; }
# IDs are newline-delimited and safe to pass as separate arguments.
# shellcheck disable=SC2086
"$engine" inspect $containers | jq -e --arg unpublished "${VERIFY_PROXY_UNPUBLISHED:-0}" '
  map({ service: (.Config.Labels["com.docker.compose.service"] // .Config.Labels["io.podman.compose.service"]),
        bindings: ((.NetworkSettings.Ports // {}) | to_entries | map(select(.value | length > 0))) })
  | if ([.[] | select(.service != "reverse-proxy" and (.bindings | length > 0))] | length > 0)
    then error("A backend container publishes a host port")
    elif ([.[] | select(.service == "reverse-proxy")] | length != 1)
    then error("Expected exactly one reverse proxy")
    elif any(.[]; .service == "reverse-proxy" and ((.bindings | length == 0) != ($unpublished == "1")))
    then error("Reverse proxy publication does not match the selected verification mode")
    else .[] | select(.service == "reverse-proxy") end
'

if [ -n "${VERIFY_URL:-}" ]; then
  curl --fail --silent --show-error --max-time 10 "${VERIFY_URL%/}/api/health" |
    jq -e '.status == "ok"'
fi
