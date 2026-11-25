# Changelog

All notable changes to SHE are documented here.

## [Unreleased]

### Added

- Core SHE protocol v1 for gateway, agent, and sandbox boundaries.
- Task/Topic state machines, event cursor model, serial topic queue, leases, and recovery.
- SQLite persistence with schema migrations and ephemeral request spool.
- TaskRunner and OpenCode agent adapter.
- Control-plane gateway.v1 Unix-socket server.
- Sandbox broker with fixed path template, Docker runtime abstraction, inbox/outbox routing, registry, and audit log.
- Public `@she/protocol` / `@she/client` packaging and gateway golden fixtures.
- Reference gateway bridge and feishu4dsh integration/migration docs.
- CI workflow and public repository hygiene files.
