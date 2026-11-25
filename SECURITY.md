# Security Policy

SHE is a local-first agent control plane that can orchestrate sandboxed agents and may eventually hold access to models, workspaces, and local services. Please treat security reports with care.

## Supported versions

The project is currently in an early `0.1.x` development phase. Only the latest `main` branch and latest published `0.1.x` packages are supported for security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected vulnerability.

Preferred reporting channels:

1. Use GitHub's private vulnerability reporting / security advisory flow for this repository.
2. If that is unavailable, contact the repository owner privately and include:
   - affected version/commit;
   - reproduction steps;
   - impact;
   - whether credentials, sandbox isolation, or broker policy are involved.

## Security boundaries

The project explicitly documents these boundaries:

- the broker is the only component intended to hold Docker control;
- agents must not receive Docker or broker sockets;
- channel adapters hold platform secrets, not SHE core;
- static bearer tokens are an early local-development mechanism and are not a substitute for OS peer credentials;
- OpenCode permission rules are defense-in-depth, not an OS sandbox;
- local control-plane sockets must remain local-only until authenticated remote transport is designed.

Do not include real credentials, private keys, customer data, or unredacted logs in reports or test fixtures.
