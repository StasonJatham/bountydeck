# Kubernetes pilot

Use a dedicated namespace on a private cluster. The renderer creates the workloads, persistent claims, ClusterIP services and ingress network policies. It expects Traefik pods in kube-system and an encrypted Longhorn StorageClass by default. Adapt the policy selectors to your ingress controller before applying.

Build and publish both images to a registry your nodes can pull from. Use the node architecture and pass immutable digests to the renderer.

```sh
docker build -t REGISTRY/bountydeck:REVISION .
docker build -t REGISTRY/bountydeck-postgres:18.6-r1 deploy/postgres
docker push REGISTRY/bountydeck:REVISION
docker push REGISTRY/bountydeck-postgres:18.6-r1
kubectl create namespace bountydeck
python3 deploy/kubernetes/render.py --origin https://bug.example.internal \
  --app-image REGISTRY/bountydeck@sha256:APP_DIGEST \
  --postgres-image REGISTRY/bountydeck-postgres@sha256:DB_DIGEST > /tmp/bountydeck-workloads.json
```

Create individual Kubernetes Secrets using your secret manager and merge this configuration without putting credential values in Git. Mount keys with these exact names.

| Secret | Keys |
| --- | --- |
| postgres | db_admin_password, db_app_password, db_worker_password, db_migrate_password, db_keycloak_password |
| application | db_app_password, auth_secret, oidc_client_secret, internal_ca |
| migrate | db_migrate_password |
| worker | db_worker_password |
| keycloak | db_keycloak_password, keycloak_admin_password, oidc_client_secret |

Shared key names must contain the same values across services. Supply the issuing CA as `internal_ca` for privately issued TLS. An empty file is suitable when the issuer already chains to a trusted system CA. The worker starts with delivery disabled until a relay or webhook destination is configured.

Render and validate against the target cluster with `kubectl apply --dry-run=server -f /tmp/bountydeck-workloads.json`. Apply the PostgreSQL workload first or wait for its readiness before creating the one-shot migration Job. The Job has a bounded retry window. The renderer emits all objects together for convenience. On updates, remove a completed migration Job before reapplying it.

Configure private DNS and ingress for the canonical HTTPS origin. Forward application paths to `application:3000` and only the required Keycloak realm and static resource paths under `/identity` to `keycloak:8080`, preserving that prefix. Leave the administration API, master realm and management listener private. The application Pod must be able to resolve, reach and verify TLS at the same issuer as the browser.

Verify rollout and migration completion, then check `/api/health` and `/identity/realms/bountydeck/.well-known/openid-configuration` over trusted HTTPS. Create individual Keycloak users through an authorized administration session. After the intended BountyDeck admin signs in once, run the existing `db/grant-admin.ts` command via a one-shot Job using the migration credential and the canonical issuer and user's OIDC subject. Keep the ordinary user under the default researcher role.

Retain the encrypted database and attachment volumes. Back up both PostgreSQL databases and the attachment claim before upgrades. Use image rollbacks or restore into a distinct namespace. Remove the private ingress before retiring the workload and retain claims until explicitly authorized to delete them.
