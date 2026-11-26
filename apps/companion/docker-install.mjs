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
      explanation: '使用 docker-ce-rootless-extras 的官方安装工具，为当前用户创建 rootless dockerd 的 user systemd service，并准备 rootless Docker context。它不会启动或替换系统 root Docker daemon。',
      note: '这一步需要前面安装的 uidmap、newuidmap/newgidmap、slirp4netns 和 fuse-overlayfs；如果提示 missing dependency，请回到第 8 步检查。',
    },
    {
      command: 'systemctl --user enable --now docker',
      explanation: '操作当前用户的 systemd --user 实例，而不是 root systemd：--now 立即启动 rootless Docker，enable 让它在下次用户服务管理器启动时自动启动。',
    },
    {
      command: 'docker context use rootless',
      explanation: 'Docker CLI 可以保存多个 endpoint context。rootless context 指向当前用户的 socket，通常是 unix:///run/user/<uid>/docker.sock；切换后 docker 命令不再默认连接 /var/run/docker.sock。',
    },
    {
      command: 'docker info --format \'{{json .SecurityOptions}}\'',
      explanation: '验证 Docker CLI 实际连接到 rootless daemon。输出的 SecurityOptions 中应包含 rootless；如果缺少，请检查 docker context、systemctl --user status docker 和 subuid/subgid。',
    },
    {
      command: 'sudo loginctl enable-linger "$USER"',
      explanation: '让当前用户的 systemd --user manager 在该用户没有任何登录会话时仍保持运行，并在开机时启动。rootless Docker 是用户级服务，默认可能随最后一个登录会话退出；开启 linger 后，SSH/桌面退出后仍可继续运行。需要管理员/polkit 权限，但不会把 Docker 变成 root daemon。',
      requiresRoot: true,
      note: '无桌面/远程部署且希望 Feishu → SHE 持续可用时建议启用。仅手动运行 start.sh 且关闭 SSH 就断开的情况，还需要把 companion/Feishu adapter 配置成 user systemd service。',
      optional: true,
    },
    {
      command: 'loginctl show-user "$USER" -p Linger',
      explanation: '验证 linger 是否生效，期望输出 Linger=yes。若仍为 no，说明 enable-linger 没有成功。',
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
