/** Rootless-first Docker installation instructions. Commands are display-only. */

import { readFile } from 'node:fs/promises'

export async function readOsRelease(path = '/etc/os-release') {
  try {
    const text = await readFile(path, 'utf8')
    const result = {}
    for (const line of text.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (match === null) continue
      result[match[1]] = match[2].replace(/^"|"$/g, '')
    }
    return result
  } catch {
    return {}
  }
}

function guide(title, steps, url, note, alternatives = []) {
  return { title, steps, commands: steps.map(step => step.command), url, note, ...(alternatives.length === 0 ? {} : { alternatives }) }
}

function subuidSteps() {
  return [
    {
      command: 'grep -E "^\$USER:" /etc/subuid /etc/subgid',
      explanation: '先检查当前用户是否已有 subordinate UID/GID 映射范围。Ubuntu 新建用户通常已由 adduser/usermod 自动分配；有类似 user:100000:65536 输出时不需要执行下一行。',
    },
    {
      command: 'sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 "$USER"',
      explanation: '仅当上一步没有输出、确实缺少范围时执行。这是 user namespace 的 UID/GID 映射池，不会让当前用户变成 root；执行后需要重新登录。',
      requiresRoot: true,
      note: '很多 Ubuntu 用户已经有自动分配的 100000-165535 范围，不需要执行这一行。',
    },
  ]
}

function rootlessSetupSteps() {
  return [
    {
      command: 'dockerd-rootless-setuptool.sh install',
      explanation: '使用 docker-ce-rootless-extras 提供的官方工具创建当前用户的 rootless Docker service；root Docker daemon 不会被使用。',
    },
    {
      command: 'systemctl --user enable --now docker',
      explanation: '启动并启用当前用户的 rootless Docker service。',
    },
    {
      command: 'docker context use rootless',
      explanation: '把 Docker CLI context 切换到当前用户的 rootless socket。',
    },
    {
      command: 'docker info --format \'{{json .SecurityOptions}}\'',
      explanation: '验证输出包含 rootless；若没有，检查 user systemd、subuid/subgid 和 rootless 依赖。',
    },
    {
      command: 'sudo loginctl enable-linger "$USER"',
      explanation: '可选：让 rootless Docker 在用户未登录时继续运行。需要管理员权限，SHE 不代你执行。',
      requiresRoot: true,
      optional: true,
    },
  ]
}

function aptMirrorSteps(project, mirrorBase, codenameExpression) {
  return [
    { command: 'sudo apt-get update', explanation: '刷新 apt 包索引。', requiresRoot: true },
    { command: 'sudo apt-get install -y ca-certificates curl gnupg', explanation: '安装下载镜像密钥和配置仓库所需工具。', requiresRoot: true },
    { command: 'sudo install -m 0755 -d /etc/apt/keyrings', explanation: '创建 apt 签名密钥目录。', requiresRoot: true },
    { command: `sudo curl -fsSL ${mirrorBase}/gpg -o /etc/apt/keyrings/docker.asc`, explanation: '从国内镜像下载 Docker 官方签名密钥。镜像只改变下载地址，密钥指纹仍需匹配 Docker 官方值。', requiresRoot: true },
    { command: 'sudo chmod a+r /etc/apt/keyrings/docker.asc', explanation: '允许 apt 读取签名密钥。', requiresRoot: true },
    { command: 'gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc', explanation: '检查输出的 fpr 字段应为 9DC858229FC7DD38854AE2D88D81803C0EBFCD88；不匹配时不要继续。', note: 'Docker CE signing key fingerprint: 9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88' },
    { command: `echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] ${mirrorBase} ${codenameExpression} stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null`, explanation: '把 apt 仓库地址切换为国内镜像；包仍会通过 Docker 官方密钥验证。', requiresRoot: true },
    { command: 'sudo apt-get update', explanation: '刷新国内镜像仓库索引。', requiresRoot: true },
    { command: 'sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras uidmap dbus-user-session fuse-overlayfs slirp4netns', explanation: '安装 Docker、官方 rootless extras 和 rootless 依赖。', requiresRoot: true },
    ...subuidSteps(),
    ...rootlessSetupSteps(),
  ]
}

function aptRootlessSteps(project, codenameExpression) {
  return [
    {
      command: 'sudo apt-get update',
      explanation: '刷新 apt 包索引。',
      requiresRoot: true,
    },
    {
      command: 'sudo apt-get install -y ca-certificates curl gnupg',
      explanation: '安装添加 Docker apt 仓库所需的基础工具。',
      requiresRoot: true,
    },
    {
      command: 'sudo install -m 0755 -d /etc/apt/keyrings',
      explanation: '创建 Docker apt 签名密钥目录。',
      requiresRoot: true,
    },
    {
      command: `sudo curl -fsSL https://download.docker.com/linux/${project}/gpg -o /etc/apt/keyrings/docker.asc`,
      explanation: '下载 Docker 官方 apt 仓库签名密钥。',
      requiresRoot: true,
    },
    {
      command: 'sudo chmod a+r /etc/apt/keyrings/docker.asc',
      explanation: '允许 apt 读取 Docker 签名密钥。',
      requiresRoot: true,
    },
    {
      command: `echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${project} ${codenameExpression} stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null`,
      explanation: '添加 Docker 官方 apt 仓库，以便安装 docker-ce-rootless-extras 等 rootless 包。',
      requiresRoot: true,
    },
    {
      command: 'sudo apt-get update',
      explanation: '刷新新加入的 Docker apt 仓库索引。',
      requiresRoot: true,
    },
    {
      command: 'sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras uidmap dbus-user-session fuse-overlayfs slirp4netns',
      explanation: '通过 apt 安装 Docker CLI/engine、官方 rootless extras 以及 uidmap、slirp4netns、fuse-overlayfs 等 rootless 依赖。',
      requiresRoot: true,
    },
    {
      command: 'sudo systemctl disable --now docker.service docker.socket',
      explanation: '可选：如果你只使用 rootless Docker，禁用系统 root Docker daemon，避免误用 root 权限的 Docker daemon；已有 root Docker 用途时跳过。',
      requiresRoot: true,
      optional: true,
    },
    ...subuidSteps(),
    ...rootlessSetupSteps(),
  ]
}

export function dockerInstallGuide(platform, osRelease = {}) {
  if (platform === 'darwin') {
    return guide(
      '安装 Docker Desktop for macOS',
      [
        { command: 'open -a Docker', explanation: '安装 Docker Desktop 后启动它；Docker Desktop 使用 VM，不要求当前用户加入 root docker 组。' },
        { command: 'docker version', explanation: '确认 Docker Desktop 的 client/server 都可用。' },
      ],
      'https://docs.docker.com/desktop/setup/install/mac-install/',
      'SHE 不安装 Docker、不执行 sudo。Docker Desktop 的权限模型由用户自行管理。',
    )
  }
  if (platform === 'win32') {
    return guide(
      '安装 Docker Desktop for Windows（WSL2 backend）',
      [
        { command: 'winget install --id Docker.DockerDesktop -e', explanation: '由你本人在 PowerShell 中安装 Docker Desktop。', requiresRoot: false },
        { command: 'wsl --status', explanation: '确认 WSL2 可用；Docker Desktop 设置中启用 WSL2 backend。' },
        { command: 'docker version', explanation: '确认 Docker Desktop 的 client/server 都可用。' },
      ],
      'https://docs.docker.com/desktop/setup/install/windows-install/',
      '不需要把 Windows 用户加入 root Docker 组；SHE 不安装 Docker、不执行管理员命令。',
    )
  }

  const id = String(osRelease.ID ?? '').toLowerCase()
  const like = String(osRelease.ID_LIKE ?? '').toLowerCase()
  if (id === 'ubuntu' || like.includes('ubuntu')) {
    return guide(
      '通过 apt 安装 rootless Docker（Ubuntu，由你本人执行）',
      aptRootlessSteps('ubuntu', '$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")'),
      'https://docs.docker.com/engine/security/rootless/',
      '默认通过 apt 安装 rootless Docker；不要把当前用户加入 docker 组。许多 Ubuntu 用户已有 subordinate UID/GID，无需额外配置。',
      [
        { label: '阿里云 Docker CE 镜像（国内网络）', steps: aptMirrorSteps('ubuntu', 'https://mirrors.aliyun.com/docker-ce/linux/ubuntu', '$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")') },
        { label: '清华 TUNA Docker CE 镜像（国内网络）', steps: aptMirrorSteps('ubuntu', 'https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/ubuntu', '$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")') },
        { label: '中科大 USTC Docker CE 镜像（国内网络）', steps: aptMirrorSteps('ubuntu', 'https://mirrors.ustc.edu.cn/docker-ce/linux/ubuntu', '$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")') },
      ],
    )
  }
  if (id === 'debian' || like.includes('debian')) {
    return guide(
      '通过 apt 安装 rootless Docker（Debian，由你本人执行）',
      aptRootlessSteps('debian', '$(. /etc/os-release && echo "$VERSION_CODENAME")'),
      'https://docs.docker.com/engine/security/rootless/',
      '默认通过 apt 安装 rootless Docker；不要把当前用户加入 docker 组。许多 Debian/Ubuntu 用户已有 subordinate UID/GID，无需额外配置。',
      [
        { label: '阿里云 Docker CE 镜像（国内网络）', steps: aptMirrorSteps('debian', 'https://mirrors.aliyun.com/docker-ce/linux/debian', '$(. /etc/os-release && echo "$VERSION_CODENAME")') },
        { label: '清华 TUNA Docker CE 镜像（国内网络）', steps: aptMirrorSteps('debian', 'https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/debian', '$(. /etc/os-release && echo "$VERSION_CODENAME")') },
      ],
    )
  }
  if (id === 'fedora') {
    return guide(
      '通过 dnf 安装 rootless Docker（Fedora，由你本人执行）',
      [
        { command: 'sudo dnf -y install dnf-plugins-core', explanation: '安装 dnf 仓库管理工具。', requiresRoot: true },
        { command: 'sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo', explanation: '添加 Docker 官方 Fedora 仓库。', requiresRoot: true },
        { command: 'sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras shadow-utils fuse-overlayfs slirp4netns', explanation: '安装 Docker、官方 rootless extras 和 rootless 依赖。', requiresRoot: true },
        ...subuidSteps(),
        ...rootlessSetupSteps(),
      ],
      'https://docs.docker.com/engine/security/rootless/',
      '默认安装 rootless Docker；不要把当前用户加入 docker 组。',
    )
  }
  if (id === 'arch') {
    return guide(
      '安装 rootless Docker（Arch Linux，由你本人执行）',
      [
        { command: 'sudo pacman -S --needed docker uidmap fuse-overlayfs slirp4netns', explanation: '安装 Docker、官方 rootless 工具和 rootless 依赖。', requiresRoot: true },
        ...subuidSteps(),
        ...rootlessSetupSteps(),
      ],
      'https://wiki.archlinux.org/title/Docker',
      '默认安装 rootless Docker；不要把当前用户加入 docker 组。',
    )
  }
  return guide(
    '按 Docker 官方 rootless 文档安装',
    [
      { command: '# https://docs.docker.com/engine/security/rootless/', explanation: '先按官方文档安装 rootless 依赖；不要加入 root docker 组。' },
      { command: 'docker info --format \'{{json .SecurityOptions}}\'', explanation: '安装后验证输出包含 rootless。' },
    ],
    'https://docs.docker.com/engine/security/rootless/',
    'SHE 不会执行 sudo，也不会请求 root。',
  )
}
