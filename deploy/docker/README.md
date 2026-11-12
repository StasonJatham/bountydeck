# Rootless Docker

Use a Linux user account with `newuidmap`, `newgidmap`, subordinate UID/GID ranges in `/etc/subuid` and `/etc/subgid`, and systemd with delegated cgroup v2 controllers. Follow [Docker's rootless installation guide](https://docs.docker.com/engine/security/rootless/). Use the rootless context explicitly and confirm it before startup.

```sh
docker context use rootless
docker info --format '{{json .SecurityOptions}}'
systemctl --user enable --now docker
```

Enable user lingering through the host administrator if the daemon must start before interactive login. Use a high host port or an existing host reverse proxy. Keep the rootless daemon's supported network driver and confirm that internal service DNS, the configured issuer and notification endpoints are reachable. Resource controls require [cgroup v2 with systemd](https://docs.docker.com/engine/security/rootless/tips/).

Initialize the secrets as the deployment user. Use the same rootless context to pull images, build, migrate and start the stack. Follow [production deployment](../../DEPLOYMENT.md) for TLS and the existing [deployment guide](../README.md) for backup and restore. Verify the running stack with the same Compose arguments used at startup.

```sh
VERIFY_URL=https://bounty.example.internal:8443 scripts/verify-docker.sh \
  -f compose.yaml -f deploy/compose.tls.yaml -f compose.override.example.yaml --profile keycloak
```

Use logical dumps and an attachment archive for a rootful-to-rootless migration. Confirm volume ownership through authorized application uploads and downloads. Restart the services, repeat the verification, then test a planned host reboot if automatic startup is required.
