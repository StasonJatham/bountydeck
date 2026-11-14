#!/usr/bin/env python3
"""Render the BountyDeck pilot workload as a Kubernetes List."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument("--origin", required=True)
parser.add_argument("--app-image", required=True)
parser.add_argument("--postgres-image", required=True)
parser.add_argument("--storage-class", default="longhorn-encrypted")
args = parser.parse_args()
origin = urlsplit(args.origin)
if origin.scheme != "https" or not origin.hostname or origin.netloc != origin.hostname or origin.path or origin.query or origin.fragment:
    parser.error("Provide a canonical HTTPS origin without a path or port")
ns = "bountydeck"
issuer = args.origin + "/identity/realms/bountydeck"
root = Path(__file__).resolve().parents[1]
items = []


def add(kind, name, spec, api="v1"):
    items.append({"apiVersion": api, "kind": kind, "metadata": {"name": name, "namespace": ns}, **spec})


add("ConfigMap", "configuration", {"data": {
    "init-postgres.sh": (root / "init-postgres.sh").read_text(),
    "bountydeck-realm.json": (root / "bountydeck-realm.json").read_text(),
    "keycloak-entrypoint.sh": (root / "keycloak-entrypoint.sh").read_text(),
}})


def selector(name):
    return {"app": name}


def claim(name, size):
    add("PersistentVolumeClaim", name, {"spec": {"storageClassName": args.storage_class,
        "accessModes": ["ReadWriteOnce"], "resources": {"requests": {"storage": size}}}})


claim("database", "10Gi")
claim("attachments", "5Gi")
for name, port in [("postgres", 5432), ("application", 3000), ("keycloak", 8080)]:
    add("Service", name, {"spec": {"selector": selector(name), "ports": [{"port": port}]}},)


def workload(name, image, command, env, secrets, *, uid=1000, storage=None,
             config=None, port=None, probe=None, memory="512Mi", job=False):
    caps = {"drop": ["ALL"]}
    if uid == 0:
        caps["add"] = ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"]
    volumes = [{"name": "secrets", "secret": {"secretName": name, "items": [
        {"key": key, "path": key} for key in secrets]}}, {"name": "tmp", "emptyDir": {"sizeLimit": "128Mi"}}]
    mounts = [{"name": "secrets", "mountPath": "/run/secrets", "readOnly": True},
              {"name": "tmp", "mountPath": "/tmp"}]
    if storage:
        claim_name, path = storage
        volumes.append({"name": "data", "persistentVolumeClaim": {"claimName": claim_name}})
        mounts.append({"name": "data", "mountPath": path})
    if config:
        volumes.append({"name": "config", "configMap": {"name": "configuration"}})
        mounts.extend({"name": "config", "mountPath": target, "subPath": source, "readOnly": True}
                      for source, target in config.items())
    if name == "postgres":
        volumes.append({"name": "socket", "emptyDir": {"sizeLimit": "16Mi"}})
        mounts.append({"name": "socket", "mountPath": "/var/run/postgresql"})
    container = {"name": name, "image": image, "imagePullPolicy": "IfNotPresent",
        "env": [{"name": key, "value": value} for key, value in env.items()],
        "securityContext": {"runAsUser": uid, "runAsNonRoot": uid != 0,
            "allowPrivilegeEscalation": False, "readOnlyRootFilesystem": name != "keycloak",
            "capabilities": caps},
        "volumeMounts": mounts, "resources": {"requests": {"cpu": "100m", "memory": "128Mi"},
            "limits": {"cpu": "2", "memory": memory}}}
    if command:
        container.update(command)
    if port:
        container["ports"] = [{"containerPort": port}]
    if probe:
        container["readinessProbe"] = {**probe, "periodSeconds": 5}
        container["startupProbe"] = {**probe, "periodSeconds": 5, "failureThreshold": 36}
    pod = {"metadata": {"labels": selector(name), "annotations": {"sidecar.istio.io/inject": "false"}},
        "spec": {"automountServiceAccountToken": False, "securityContext": {
            "seccompProfile": {"type": "RuntimeDefault"}, "fsGroup": 1000},
            "restartPolicy": "Never" if job else "Always", "containers": [container], "volumes": volumes}}
    spec = {"template": pod}
    if job:
        spec.update(backoffLimit=2, activeDeadlineSeconds=300)
    else:
        spec.update(replicas=1, selector={"matchLabels": selector(name)}, strategy={"type": "Recreate"})
    add("Job" if job else "Deployment", name, {"spec": spec}, "batch/v1" if job else "apps/v1")


workload("postgres", args.postgres_image, {"args": ["postgres", "-c", "max_connections=100"]},
    {"POSTGRES_PASSWORD_FILE": "/run/secrets/db_admin_password", "POSTGRES_INITDB_ARGS": "--auth-host=scram-sha-256"},
    ["db_admin_password", "db_app_password", "db_worker_password", "db_migrate_password", "db_keycloak_password"],
    uid=0, storage=("database", "/var/lib/postgresql"),
    config={"init-postgres.sh": "/docker-entrypoint-initdb.d/10-bountydeck.sh"},
    port=5432, probe={"exec": {"command": ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"]}}, memory="1Gi")
workload("migrate", args.app_image, {"args": ["node", "db/migrate.ts"]},
    {"BOUNTYDECK_SERVICE": "migrate"}, ["db_migrate_password"], job=True)
workload("application", args.app_image, None,
    {"AUTH_URL": args.origin, "APP_ORIGIN": args.origin, "OIDC_ISSUER": issuer,
     "OIDC_CLIENT_ID": "bountydeck", "ATTACHMENTS_DIR": "/var/lib/bountydeck/attachments"},
    ["db_app_password", "auth_secret", "oidc_client_secret", "internal_ca"],
    storage=("attachments", "/var/lib/bountydeck/attachments"), port=3000,
    probe={"httpGet": {"path": "/api/health", "port": 3000}}, memory="1Gi")
workload("worker", args.app_image, {"args": ["node", "--experimental-strip-types", "notifications/worker.ts"]},
    {"BOUNTYDECK_SERVICE": "worker", "APP_ORIGIN": args.origin}, ["db_worker_password"])
workload("keycloak", "quay.io/keycloak/keycloak:26.8.2@sha256:c68e286cacd87b942ac1939a0a1481461109d6acd3a57dc496969a319a76bbf0",
    {"command": ["/bin/bash", "/opt/keycloak/bountydeck-entrypoint.sh"]},
    {"KC_DB": "postgres", "KC_DB_URL": "jdbc:postgresql://postgres:5432/keycloak",
     "KC_DB_USERNAME": "bossob_keycloak", "KC_HTTP_ENABLED": "true", "KC_HTTP_RELATIVE_PATH": "/identity",
     "KC_HOSTNAME": args.origin + "/identity", "KC_PROXY_HEADERS": "xforwarded",
     "KC_BOOTSTRAP_ADMIN_USERNAME": "bountydeck-bootstrap", "KC_HEALTH_ENABLED": "true",
     "KC_HTTP_MANAGEMENT_HOST": "127.0.0.1", "KC_HTTP_MANAGEMENT_RELATIVE_PATH": "/",
     "KEYCLOAK_REALM": "bountydeck", "OIDC_CLIENT_ID": "bountydeck", "AUTH_URL": args.origin,
     "KEYCLOAK_SSL_REQUIRED": "all"}, ["db_keycloak_password", "keycloak_admin_password", "oidc_client_secret"],
    config={"keycloak-entrypoint.sh": "/opt/keycloak/bountydeck-entrypoint.sh",
            "bountydeck-realm.json": "/opt/keycloak/data/import/bountydeck-realm.json"},
    port=8080, probe={"exec": {"command": ["bash", "-ec",
        """{ printf 'HEAD /health/ready HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n' >&0; grep -q '^HTTP/1.1 200'; } 0<>/dev/tcp/127.0.0.1/9000"""]}},
    memory="1536Mi")

add("NetworkPolicy", "isolate", {"spec": {"podSelector": {}, "policyTypes": ["Ingress"]}},
    "networking.k8s.io/v1")
add("NetworkPolicy", "database-clients", {"spec": {"podSelector": {"matchLabels": selector("postgres")},
    "policyTypes": ["Ingress"], "ingress": [{"from": [{"podSelector": {"matchExpressions": [
        {"key": "app", "operator": "In", "values": ["application", "worker", "migrate", "keycloak"]}]}}],
        "ports": [{"port": 5432}]}]}}, "networking.k8s.io/v1")
add("NetworkPolicy", "ingress-controller", {"spec": {"podSelector": {"matchExpressions": [
    {"key": "app", "operator": "In", "values": ["application", "keycloak"]}]},
    "policyTypes": ["Ingress"], "ingress": [{"from": [{
        "namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "kube-system"}},
        "podSelector": {"matchLabels": {"app.kubernetes.io/name": "traefik"}}}],
        "ports": [{"port": 3000}, {"port": 8080}]}]}}, "networking.k8s.io/v1")
print(json.dumps({"apiVersion": "v1", "kind": "List", "items": items}, indent=2))
