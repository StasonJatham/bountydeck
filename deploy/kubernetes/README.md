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

The [Traefik example](traefik.example.yaml) restricts cluster ingress to the private edge proxy. Replace the example hostname and source address. Configure the edge's OIDC backchannel for discovery, token, JWKS and userinfo. If the application's outbound source differs from client addresses, permit only those endpoint paths from the application's verified egress address. Keep the browser route private and verify the app can reach discovery with normal TLS verification.

For a cluster that preloads images, import the built images on the intended node and use the loaded references in the rendered manifests. Pin the workload templates to that node until all eligible nodes have the required images. Include the Keycloak image in the preload and adjust its Deployment image if the import uses a local alias.

### Application releases

Application and worker Deployments use rolling updates with `maxUnavailable: 0` and
`maxSurge: 1`. Keep enough capacity for the additional pod and run compatible
database migrations before changing the application image. When using a
ReadWriteOnce attachment claim, both application replicas must be able to
mount it on the same node during the rollout. For multi-node scheduling use
shared storage that supports concurrent mounts across nodes. PostgreSQL and
Keycloak have separate upgrade procedures. The rollout policy is for application
releases and does not provide high availability for either dependency.

### Keycloak user administration

To enable the user management controls, create a dedicated confidential client
named `bountydeck-user-admin` in the BountyDeck realm. Enable service accounts
and disable interactive and password-grant flows on this client. Grant its
service account the realm-local `realm-management/manage-users` role. Create a
`bountydeck-managed` group for ordinary accounts managed by BountyDeck. Keep
realm administrators, service accounts and privileged group memberships outside
that group. Add the client credential to the application Secret under
`keycloak_user_admin_secret` and render with `--managed-users`. This option
adds direct cluster-local access from the application to Keycloak. Keep the
Keycloak administration API blocked at the public ingress.

### Outgoing webhooks

Pass `--webhook-destinations /path/to/destinations.json` to the renderer to
configure approved origins for both the application and notification worker.
For example, `{"https://flows.example.org":["192.0.2.10"]}` illustrates the
format. Replace the example origin and address with your Node-RED receiver.
Users enter the HTTPS URL including its flow path under **Notifications**.
Keep receiver credentials and signing secrets out of the origin map.

After publishing or preloading an image, run the release helper from a trusted
deployment environment:

```sh
./deploy/kubernetes/release.py --context YOUR_CONTEXT REGISTRY/bountydeck@sha256:APP_DIGEST
```

Keep the initial `migrate` Job as the template. The helper uses a separate Job
per image, waits for migrations, then updates the application and worker in
order. A failed migration stops the release before either Deployment changes.
Inspect its logs before retrying and remove only the failed per-image Job after
correcting its failure. Re-running a successful release reuses its migration Job.
A release pipeline can invoke the same command after building the image, with
one deployment run at a time per namespace. No runner is installed by this
repository.
