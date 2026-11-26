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

function guide(title, steps, url, note) {
  return { title, steps, commands: steps.map(step => step.command), url, note }
}

function commonRootlessSteps(prerequisiteCommand) {
  return [
    {
      command: prerequisiteCommand,
      explanation: '安装 rootless 所需依赖：uidmap/newuidmap、newgidmap、slirp4netns 和 fuse-overlayfs，用于用户命名空间和文件系统。',
      requiresRoot: true,
    },
    {
      command: 'grep -E "^\\$USER:" /etc/subuid /etc/subgid',
      explanation: '检查当前用户是否已有 subordinate UID/GID 范围；没有输出时执行下一步。',
    },
    {
      command: 'sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 "$USER"',
      explanation: '为当前用户分配 subordinate UID/GID。这是一次性管理员操作；完成后需要重新登录。',
      requiresRoot: true,
    },
    {
      command: 'curl -fsSL https://get.docker.com/rootless | sh',
      explanation: '运行 Docker 官方 rootless 安装脚本，只把 rootless Docker 工具安装到当前用户目录。',
      note: '该脚本由你本人执行；SHE 不会下载或运行管道脚本。',
    },
    {
      command: 'export PATH="$HOME/bin:$PATH"',
      explanation: '让当前 shell 找到刚安装的 rootless Docker CLI 和 dockerd-rootless-setuptool.sh。',
    },
    {
      command: 'dockerd-rootless-setuptool.sh install',
      explanation: '创建并启动用户级 dockerd rootless service，不修改 root Docker daemon。',
    },
    {
      command: 'docker context use rootless',
      explanation: '把 Docker CLI 的 context 切换为当前用户的 rootless socket。',
    },
    {
      command: 'docker info --format \'{{json .SecurityOptions}}\'',
      explanation: '验证输出包含 rootless；若没有，请检查 user systemd 和 subordinate UID/GID 配置。',
    },
    {
      command: 'systemctl --user enable docker',
      explanation: '可选：登录后自动启动 rootless Docker。',
      optional: true,
    },
    {
      command: 'sudo loginctl enable-linger "$USER"',
      explanation: '可选：让用户级服务在未登录时也运行。需要管理员权限，SHE 不代你执行。',
      requiresRoot: true,
      optional: true,
    },
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
  if (id === 'ubuntu' || like.includes('ubuntu') || id === 'debian' || like.includes('debian')) {
    return guide(
      '安装 rootless Docker（Debian/Ubuntu，由你本人执行）',
      commonRootlessSteps('sudo apt-get update && sudo apt-get install -y uidmap dbus-user-session fuse-overlayfs slirp4netns'),
      'https://docs.docker.com/engine/security/rootless/',
      '默认只安装 rootless Docker。不要把当前用户加入 docker 组；docker 组可能等价于 root 权限。',
    )
  }
  if (id === 'fedora') {
    return guide(
      '安装 rootless Docker（Fedora，由你本人执行）',
      commonRootlessSteps('sudo dnf install -y shadow-utils fuse-overlayfs slirp4netns'),
      'https://docs.docker.com/engine/security/rootless/',
      '默认只安装 rootless Docker。不要把当前用户加入 docker 组。',
    )
  }
  if (id === 'arch') {
    return guide(
      '安装 rootless Docker（Arch Linux，由你本人执行）',
      commonRootlessSteps('sudo pacman -S --needed uidmap fuse-overlayfs slirp4netns'),
      'https://wiki.archlinux.org/title/Docker',
      '默认只安装 rootless Docker。不要把当前用户加入 docker 组。',
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
