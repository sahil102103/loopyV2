"""Small API regression tests for responses that must not leak configuration."""

import os
import sys
import unittest


BACKEND_DIR = os.path.dirname(__file__)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app import app


class AppSecurityTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_health_is_public_but_does_not_expose_environment(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "ok"})

    def test_invalid_graph_gets_a_safe_validation_response(self):
        response = self.client.post("/simulation/two-phase", json={
            "nodes": [{"name": "A"}, {"name": "A"}],
            "edges": [],
        })
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertIn("error", payload)
        self.assertNotIn("trace", payload)
        self.assertNotIn("DATABASE_URL", str(payload))


if __name__ == "__main__":
    unittest.main()
