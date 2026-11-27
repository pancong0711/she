# Changelog

All notable changes to SHE are documented here.

## [Unreleased]

### Fixed

- Introduced the unified `SHE_HOME` app layout (app/core/config/state/run/bin/workspaces), with legacy-layout detection and a safe copy migration API/CLI.
- Start scripts now use an installed launcher immediately and only bootstrap from the network on first install or explicit launcher repair.
- New installs use `SHE_HOME/bin` and write both `she` and `she-companion` commands; legacy installs keep their old command location.
- Core update channel is Pages-first with GitHub Release fallback, and Pages hosts the matching core bundle.
- Marked the built-in Feishu gateway as legacy; new deployments should use feishu4dsh standalone gateway.
- Added unified App/Core update status and PWA Settings controls for version checks and SHE_HOME migration.

- Companion page updates now honor the manifest's absolute `bundle.url` instead of resolving it against the GitHub Pages channel directory, which previously downloaded an HTML 404 page.
- `start.sh` / `start.ps1` now fall back from curl to Node fetch, then to a Pages-hosted launcher mirror, and finally to an already installed launcher when GitHub release downloads fail.
- PWA builds now emit `she-launcher.mjs` beside the Pages channel manifest so first installs have a second bootstrap host.
- Companion 0.7.9 and core 0.3.2 releases include the gateway.v1 `POST /v1/messages` direct-message endpoint; companion bundle/launcher also have checksum-verified GitHub Pages fallback mirrors for unreliable release downloads.

### Added

- Added Sandbox creation form and detailed Agent Migration mount/network/runtime guidance.
- Added headless persistence checks (systemd --user, linger, companion autostart, OpenCode/Feishu health) to environment preflight.
- Expanded Docker rootless steps 12–17 with systemd --user, Docker context, rootless verification, linger, and headless deployment guidance.
- Fixed Docker install guide API to include mirror alternatives, enabling the Packages install-source dropdown.
- Fixed service worker caching live /api responses; companion shutdown now shows offline and environment/package data refreshes correctly.
- Added Docker install-source dropdown, direct environment recheck/result refresh, and clearer Core action wait states.
- Added Packages sandbox image presets/default resources, local image detection, Agent Migration defaults, equal-height scrollable package cards, and explicit single-worker Chat notice.
- Added Linux /proc socket-owner fallback to terminate orphaned cores that predate /v1/admin/shutdown.
- Added China Docker CE apt mirror alternatives (Aliyun/TUNA/USTC) with official signing-key fingerprint verification.
- Docker rootless guide now uses Docker's official apt packages (`docker-ce-rootless-extras` + uidmap/slirp4netns/fuse-overlayfs) instead of requiring the rootless curl script.
- Clarified subordinate UID/GID: Ubuntu users often already have ranges; only add them when the explicit check is empty.
- Fixed core startup SQLite parent-directory creation and DB file permissions; companion now pre-creates the default DB directory before launching core.
- Fixed core updates to force-reinstall an existing target version and roll back on installer failure.
- Added authenticated control-plane admin shutdown so companion can recover external/orphaned core processes.
- Docker installation guidance is now rootless-first and provides per-command explanations; do not add the user to the root docker group by default.
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
