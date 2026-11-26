# Changelog

All notable changes to SHE are documented here.

## [Unreleased]

### Added

- Added explicit first-run Core install actions and moved source-only dependency/build/test actions into a clearly labelled developer-tools section.
- Expanded Packages into a dependency catalog with requirement/usage metadata, platform-specific install commands, copy buttons, official docs links, and entries for git/bash/curl/tar/SHA-256/OpenCode alongside Docker/Node/pnpm/companion/core.
- Improved preflight diagnostics: required vs optional/sandbox capabilities, Docker ENOENT/permission/daemon guidance, remediation text, and explicit `succeeded-with-warnings` messaging in Install & Doctor.
- Local AI agent discovery and containerization migration assistant: process/port/cwd scan, dry-run plans, explicit credential-directory read-only mounts, broker-validated host mounts, one-click sandbox migration jobs, rollback on partial failure, and PWA Agent Migration page.
- Core SHE protocol v1 for gateway, agent, and sandbox boundaries.
- Task/Topic state machines, event cursor model, serial topic queue, leases, and recovery.
- SQLite persistence with schema migrations and ephemeral request spool.
- TaskRunner and OpenCode agent adapter.
- Control-plane gateway.v1 Unix-socket server.
- Sandbox broker with fixed path template, Docker runtime abstraction, inbox/outbox routing, registry, and audit log.
- Public `@she/protocol` / `@she/client` packaging and gateway golden fixtures.
- Reference gateway bridge and feishu4dsh integration/migration docs.
- CI workflow and public repository hygiene files.
- Vue 3/Vite PWA shell, local loopback host, control-plane/broker API proxy, manifest, service worker, read-only Dashboard/Tasks/Sandboxes pages, onboarding/companion connection, PNG install icons, and GitHub Pages deployment.
- PWA Install & Doctor page with allowlisted local jobs, environment checks, dependency/build/test actions, and live NDJSON logs.
- Public package release `v0.1.0-packages.1` with protocol/client/gateway-sdk tarballs and pnpm override consumption guidance.
- ADR-0001 defining a stable companion layer, replaceable core bundles, `companion-api.v1`, and a stable `run-core` entrypoint with staged updates and rollback.
- Extracted `apps/companion`, added companion v1 status/capability APIs, `run-core` supervisor entrypoints, and a deterministic release manifest generator.
- Added mandatory environment preflight before dependency installation, live check results in PWA, and `/api/preflight`.
- Added ADR-0002: SHE never executes or requests root; preflight checks non-root UID and warns when Docker access is root-equivalent rather than rootless.
- Added user-level bootstrap scripts and a companion `bootstrap` job for installing pnpm without sudo; PWA reruns preflight after bootstrap.
- Added esbuild core bundles, stable `run-core` entrypoint resolution, user-level versioned core installation, and SHA-256 release manifest generation.
- Added companion core supervisor and two-phase update flow with staged download, SHA verification, stop/switch/start, health checks, automatic rollback, and PWA update UI.
- Published core bundle `v0.1.0-core.1` with release manifest and SHA-256-verifiable bundle.
- Added checksum-verified companion bundle/installer, PWA download links, and an explicit no-online-self-update boundary for companion.
- Added assignment-assistant-style one-click launchers (`start.bat`, `start.ps1`, `start.command`, `start.sh`) that download, verify, install, start companion, and open the PWA without root.
- Added companion package inventory API and PWA Packages page for companion/core/runtime status, launcher downloads, core updates, and user-level pnpm bootstrap.
- Added control-plane OpenCode worker, persisted agent events, gateway agent.delta mapping, and PWA Chat for task submission and live agent output.
- Added PWA settings for worker/OpenCode/workspace/model configuration with a 0600 companion config file and core restart application.
