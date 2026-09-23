import json
import unittest

from app.services.keychain import Credentials, FakeCredentialStore, SystemKeychainStore


class CredentialStoreTests(unittest.TestCase):
    def test_status_never_returns_values(self):
        store = FakeCredentialStore(
            Credentials(api_key="secret-key", workspace_id="workspace-secret")
        )

        serialized = json.dumps(store.status().model_dump())

        self.assertNotIn("secret-key", serialized)
        self.assertNotIn("workspace-secret", serialized)
        self.assertEqual(
            store.status().model_dump(),
            {
                "api_key_configured": True,
                "workspace_configured": True,
            },
        )

    def test_system_keychain_passes_secrets_in_memory(self):
        class MemoryBackend:
            def __init__(self):
                self.values = {}

            def read(self, service, account):
                return self.values.get((service, account), "")

            def write(self, service, account, value):
                self.values[(service, account)] = value

            def delete(self, service, account):
                self.values.pop((service, account), None)

        backend = MemoryBackend()
        store = SystemKeychainStore(backend=backend, account="test-account")

        store.set(Credentials(api_key="secret-key", workspace_id="workspace-secret"))
        self.assertEqual(store.get().api_key, "secret-key")
        self.assertEqual(store.get().workspace_id, "workspace-secret")
        store.clear()
        self.assertFalse(store.status().api_key_configured)


if __name__ == "__main__":
    unittest.main()
