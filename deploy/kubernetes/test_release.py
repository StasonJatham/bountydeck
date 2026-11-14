import unittest

from release import migration_job


class ReleaseTest(unittest.TestCase):
    def test_migration_uses_release_image_and_fresh_job_identity(self):
        template = {
            "spec": {
                "activeDeadlineSeconds": 60,
                "template": {
                    "metadata": {
                        "labels": {"batch.kubernetes.io/controller-uid": "old"},
                        "annotations": {"sidecar.istio.io/inject": "false"},
                    },
                    "spec": {"containers": [{"name": "migrate", "image": "old"}]},
                },
            },
        }
        job = migration_job(template, "example.org/app:abcdef1", "qa")
        self.assertEqual(job["metadata"]["namespace"], "qa")
        self.assertEqual(job["spec"]["activeDeadlineSeconds"], 60)
        self.assertEqual(job["spec"]["template"]["metadata"]["labels"], {"app": "migrate"})
        self.assertEqual(job["spec"]["template"]["spec"]["containers"][0]["image"], "example.org/app:abcdef1")
        self.assertNotEqual(job["metadata"]["name"], migration_job(template, "example.org/app:abcdef2", "qa")["metadata"]["name"])


if __name__ == "__main__":
    unittest.main()
