#!/usr/bin/env python3
"""Migrate and roll out a published BountyDeck application image."""
import argparse
import hashlib
import json
import re
import subprocess


def migration_job(template, image, namespace):
    source = template["spec"]
    pod = source["template"]
    containers = pod["spec"]["containers"]
    if len(containers) != 1 or containers[0]["name"] != "migrate":
        raise ValueError("Expected a single migrate container in the migration Job")
    containers[0]["image"] = image
    return {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {
            "name": "migrate-" + hashlib.sha256(image.encode()).hexdigest()[:16],
            "namespace": namespace,
        },
        "spec": {
            "template": {
                "metadata": {
                    "labels": {"app": "migrate"},
                    "annotations": pod["metadata"].get("annotations", {}),
                },
                "spec": pod["spec"],
            },
            "backoffLimit": source.get("backoffLimit", 0),
            "activeDeadlineSeconds": source.get("activeDeadlineSeconds", 300),
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", help="Image pinned by digest, or a preloaded commit-tagged image")
    parser.add_argument("--namespace", default="bountydeck")
    parser.add_argument("--context", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[^\s@]+(?:@sha256:[0-9a-f]{64}|:[0-9a-f]{7,40})", args.image):
        parser.error("Provide an image digest or a commit-SHA tag")
    command = ["kubectl", "--context", args.context, "--namespace", args.namespace]

    def kubectl(*values, **kwargs):
        return subprocess.run(command + list(values), check=True, text=True, **kwargs)

    template = json.loads(kubectl("get", "job", "migrate", "-o", "json",
                                  capture_output=True).stdout)
    job = migration_job(template, args.image, args.namespace)
    name = job["metadata"]["name"]
    existing = kubectl("get", "job", name, "--ignore-not-found", "-o", "name",
                       capture_output=True).stdout
    if not existing.strip():
        kubectl("create", "-f", "-", input=json.dumps(job))
    kubectl("wait", "--for=condition=complete", f"job/{name}", "--timeout=360s")
    for name in ("application", "worker"):
        kubectl("set", "image", f"deployment/{name}", f"{name}={args.image}")
        kubectl("rollout", "status", f"deployment/{name}", "--timeout=300s")


if __name__ == "__main__":
    main()
