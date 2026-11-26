/** Reviewed, pinned agent runtime recipes for sandbox bootstrap and install. */

const NODE_FULL_IMAGE = 'node:24-bookworm'

function shellJoin(lines) {
  return ['sh', '-lc', ['set -eu', ...lines].join('\n')]
}

function installScript(recipe) {
  return [
    'export HOME=/home/agent',
    'export PATH="/home/agent/.local/bin:$PATH"',
    `export NPM_CONFIG_PREFIX=/home/agent/.agents/${recipe.id}/${recipe.version}`,
    'mkdir -p /home/agent/.local/bin /home/agent/.config /home/agent/.local/share /home/agent/.agents /cache/npm',
    `PREFIX=/home/agent/.agents/${recipe.id}/${recipe.version}`,
    'rm -rf "$PREFIX"',
    'mkdir -p "$PREFIX"',
    `npm install --global --prefix "$PREFIX" --no-fund --no-audit --loglevel=warn ${recipe.packageName}@${recipe.version}`,
    `ln -sfn "$PREFIX/bin/${recipe.binary}" /home/agent/.local/bin/${recipe.binary}`,
    `ln -sfn "$PREFIX" /home/agent/.agents/${recipe.id}/current`,
    `command -v ${recipe.binary}`,
  ]
}

function recipe(input) {
  const command = shellJoin(installScript(input))
  const check = shellJoin([
    'export HOME=/home/agent',
    'export PATH="/home/agent/.local/bin:$PATH"',
    `command -v ${input.binary}`,
  ])
  const bootstrap = shellJoin([
    ...installScript(input),
    'exec sleep infinity',
  ])
  return {
    schema: 1,
    id: input.id,
    label: input.label,
    description: input.description,
    packageName: input.packageName,
    version: input.version,
    binary: input.binary,
    image: input.image ?? NODE_FULL_IMAGE,
    networkMode: input.networkMode ?? 'egress',
    requirements: input.requirements ?? ['Node.js in base image', 'network egress to npm registry'],
    notes: input.notes ?? [],
    knownVersions: input.knownVersions ?? [input.version],
    install: { command, cwd: '/workspace', timeoutMs: input.timeoutMs ?? 300_000 },
    verify: { command: check, cwd: '/workspace', timeoutMs: 30_000 },
    bootstrap: { command: bootstrap, cwd: '/workspace', timeoutMs: input.timeoutMs ?? 300_000 },
    exampleCommand: input.exampleCommand,
  }
}

export const SANDBOX_AGENT_RECIPES = [
  recipe({
    id: 'opencode',
    label: 'OpenCode',
    description: 'OpenCode coding agent CLI；安装到 /home/agent/.local，不写入只读 rootfs。',
    packageName: '@opencode/cli',
    version: '2.4.2',
    binary: 'opencode',
    requirements: ['Node.js >= 20', '可用 npm registry', '若作为服务使用还需 OpenCode 配置'],
    notes: [
      '@opencode/cli 需要平台对应的 optional dependency；Linux x64/arm64 由 npm 自动选择。',
      '服务模式示例：opencode serve --hostname 0.0.0.0 --port 4096；SHE worker 自动路由尚未接入。',
    ],
    knownVersions: ['2.4.2', '2.3.2', '2.4.1', '2.4.0'],
    exampleCommand: 'opencode --version',
  }),
  recipe({
    id: 'dsh',
    label: 'dsh',
    description: 'DeepSeek Harness CLI；需要 Node.js >= 24.9。',
    packageName: '@deepseek-ai/dsh',
    version: '0.2.2-rc.5',
    binary: 'dsh',
    requirements: ['Node.js >= 24.9', '可用 npm registry', 'profile 配置需用户提供'],
    notes: [
      'dsh 是 profile/plugin CLI；安装不等于配置 dsh profile。',
      '当前 recipe 使用 node:24-bookworm，若镜像内 Node 低于 24.9 会在安装时失败。',
    ],
    exampleCommand: 'dsh --version',
  }),
  recipe({
    id: 'hermes',
    label: 'Hermes Agent',
    description: 'Hermes Agent npm bridge；首次安装/启动可能下载受管 Python runtime。',
    packageName: 'hermes-agent',
    version: '0.23.4',
    binary: 'hermes',
    requirements: ['Node.js >= 20', 'git/curl', 'Python 由 hermes-agent 的 uv 受管运行时提供', 'network egress'],
    notes: [
      '首次安装或首次启动可能耗时 1–2 分钟并访问 GitHub。',
      'Hermes 的 profile、模型 API key 和审批配置仍需在容器内单独配置。',
    ],
    timeoutMs: 300_000,
    exampleCommand: 'hermes --help',
  }),
  recipe({
    id: 'pi',
    label: 'Pi coding agent',
    description: 'Pi coding agent CLI，包含 read/bash/edit/write 工具与会话管理。',
    packageName: '@mariozechner/pi-coding-agent',
    version: '0.73.1',
    binary: 'pi',
    requirements: ['Node.js >= 20.6', '可用 npm registry'],
    notes: [
      'Pi 的模型 provider/API key 仍需在容器内配置。',
      '当前 recipe 只安装 CLI，不自动启动 agent 进程。',
    ],
    exampleCommand: 'pi --help',
  }),
]

export function sandboxAgentRecipeCatalog() {
  return SANDBOX_AGENT_RECIPES.map(({ schema, id, label, description, packageName, version, binary, image, networkMode, requirements, notes, knownVersions, install, verify, bootstrap, exampleCommand }) => ({
    schema,
    id,
    label,
    description,
    packageName,
    version,
    binary,
    image,
    networkMode,
    requirements,
    notes,
    knownVersions,
    install,
    verify,
    bootstrap,
    ...(exampleCommand === undefined ? {} : { exampleCommand }),
  }))
}

export function sandboxAgentRecipeWithVersion(agentId, version) {
  const base = SANDBOX_AGENT_RECIPES.find(item => item.id === agentId)
  if (base === undefined) throw new Error(`unknown sandbox agent: ${agentId}`)
  const text = String(version ?? '').trim()
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,79}$/.test(text)) throw new Error('agent version is invalid')
  return recipe({ ...base, version: text })
}
