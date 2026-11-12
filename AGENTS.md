# BountyDeck

Follow the backlog in TASKS.md. Keep every privileged operation scoped on the server. Run sensitive queries in an actor-scoped transaction. Keep demo data in test fixtures and never execute report content or evidence. Verify each milestone against TESTING.md before marking it DONE.

Use the commands in TESTING.md to rerun the acceptance suite. The local Compose fixture deployment includes synthetic Keycloak identities. Production initialization starts with an empty application database and an empty Keycloak realm.
