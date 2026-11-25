# Contributing to SHE

## Development setup

Requirements:

- Node.js `^22.19.0 || >=24.0.0`
- pnpm `11.22.0` (see `packageManager` in `package.json`)

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

## Repository layout

```text
packages/protocol/       public wire contracts and golden fixtures
packages/core/           pure domain model, state machines, ports
packages/control/        queue, task service, task runner
packages/store-sqlite/   SQLite persistence
packages/client/         gateway/broker clients
packages/gateway-sdk/    channel adapter contract + reference bridge
packages/agent-sdk/      agent adapter contract
packages/sandbox-sdk/    sandbox provider contract
packages/adapters/       OpenCode and future/docker adapters
apps/control-plane/      SHE control daemon
apps/broker/             sandbox broker daemon
docs/                    architecture, requirements, task board
```

## Required checks

Every change should pass:

```sh
pnpm typecheck
pnpm test
pnpm pack:public
```

For protocol changes also update:

- `packages/protocol/src/fixtures.ts`;
- README/compatibility docs;
- migration notes when behavior is breaking.

## Boundaries

- Do not import Feishu, dsh, Docker, or SQLite into `protocol`/`core`.
- Do not make SHE depend on `feishu4dsh` internals.
- Do not expose Docker or broker sockets to agent/sandbox containers.
- Do not commit real credentials, tokens, private keys, or local absolute paths.
- Do not silently change SQLite schemas; add a migration and backup/rollback notes.

## Commit and PR expectations

- keep changes scoped;
- add tests for new behavior and negative/security cases;
- update docs and task board with status;
- describe security-relevant changes explicitly;
- do not rewrite published history without owner approval.
