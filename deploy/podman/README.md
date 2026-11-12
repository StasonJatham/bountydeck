# Rootless Podman

Use a Linux user with subordinate UID/GID mappings, systemd, cgroup v2 and the distribution's supported rootless Podman networking. Use Docker Compose v2.24.4 or newer as the external Compose provider for the common configuration. Verify the provider on the target system. Use conmon 2.2.0 or newer for file log rotation with the configured `max-file` option. [Podman Compose documentation](https://docs.podman.io/en/latest/markdown/podman-compose.1.html)

```sh
systemctl --user enable --now podman.socket
export PODMAN_COMPOSE_PROVIDER=docker-compose
podman compose version
podman info --format json | jq '.host.security.rootless'
```

The provider communicates with the user's Podman socket on the host. Keep that socket private. Use high ports and the same Compose files, environment and secrets as in [production deployment](../../DEPLOYMENT.md). Substitute `podman compose` in the deployment guide. On an SELinux host, give the deploy user's exact configuration and secret bind sources appropriate container file labels. Use a shared label for files mounted by multiple services, such as the CA. Keep the enclosing secret directory private. Verify the provider's file-backed secret behavior and labels before promoting the deployment. Named volumes should be initialized in the target user namespace.

```sh
VERIFY_URL=https://bounty.example.internal:8443 scripts/verify-podman.sh \
  -f compose.yaml -f deploy/compose.tls.yaml -f compose.override.example.yaml --profile keycloak
```

Check startup ordering and restart behavior with the selected provider. For unattended restart, use the distribution's user systemd restart facilities and configure lingering if required. Test service restart and a host reboot before relying on it. If the provider rejects the required security or Compose settings, stop and resolve that compatibility issue on the target host. Runtime compatibility is tracked in [HARDENING.md](../../HARDENING.md).
