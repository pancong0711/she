# Changelog

All notable changes to SHE are documented here.

## [Unreleased]

### Added

- Added separate PWA build / companion API version display and a one-click local service-worker/cache reset for version-mismatch diagnosis.
- Added task report artifacts: successful tasks persist Markdown reports, emit artifact events, and expose list/download APIs with Chat download links.
- Audit fixes: reset supervisor restart budget after stable uptime, launch supervisor from Windows installer, and quote Windows/XDG autostart paths.
- Gateway page with loopback-only feishu4dsh health probing and explicit external secret boundary.
- Added Gateway configuration/status page with loopback-only feishu4dsh health probing and explicit external secret boundary.
- Added user-level companion login autostart, installed-bundle source-job guards, and distro-specific Docker installation commands.
- Companion 0.3.1 binds Agent Migration workspace mounts to explicit authorization IDs and publishes the new release tag.
- Agent Migration now binds reused/legacy workspace mounts to explicit Workspaces authorization IDs; read-only authorizations can only be legacy read-only mounts.
- Added supervisor-managed companion restart/shutdown/update from the PWA, with version display, SHA-256 verification, and startup-failure rollback.
- Companion 0.2.1 adds no-cache headers for start scripts/manifest and network-first service worker updates, plus reliable launcher version checks and stale-process detection.
- Companion release tag moved to `v0.2.0-companion.2` to avoid stale GitHub release manifest CDN content; release assets are treated as immutable.
- Fixed launcher update detection (`-x` check on non-executable server.mjs) and added explicit stale-companion process detection to avoid silent EADDRINUSE failures.
- Companion version is now decoupled from the root/core package version; new companion release `v0.2.0-companion.1` fixes stale launcher update detection.
- Added a workspace authorization registry and PWA Workspaces page with leaf-directory validation, read-only/read-write intent, realpath checks, and 0600 persistence.
- Added `/api/platform` and an Install & Doctor platform support matrix with explicit verified / implemented-unverified / design-only / unsupported statuses.
- Added read-only Agents page and `GET /v1/agents` with OpenCode health, worker configuration, credential-file path only, and workspace authorization details.
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
