/** Platform/distro-specific Docker installation instructions. Commands are display-only. */

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

export function dockerInstallGuide(platform, osRelease = {}) {
  if (platform === 'darwin') {
    return {
      title: '安装 Docker Desktop for macOS',
      commands: [
        '# 由你本人安装并启动 Docker Desktop（不要用 sudo 运行 SHE）',
        '# 下载：https://docs.docker.com/desktop/setup/install/mac-install/',
        'docker version',
      ],
      url: 'https://docs.docker.com/desktop/setup/install/mac-install/',
      note: 'SHE 不安装 Docker、不执行 sudo。Docker Desktop 的权限模型由用户自行管理。',
    }
  }
  if (platform === 'win32') {
    return {
      title: '安装 Docker Desktop for Windows（WSL2 backend）',
      commands: [
        '# 由你本人在 PowerShell 中安装并启动 Docker Desktop',
        'winget install --id Docker.DockerDesktop -e',
        '# 在 Docker Desktop 设置中启用 WSL2 backend',
        'docker version',
      ],
      url: 'https://docs.docker.com/desktop/setup/install/windows-install/',
      note: '需要 WSL2；SHE 不安装 Docker、不执行管理员命令。',
    }
  }
  const id = String(osRelease.ID ?? '').toLowerCase()
  const like = String(osRelease.ID_LIKE ?? '').toLowerCase()
  if (id === 'ubuntu' || like.includes('ubuntu')) {
    return {
      title: '安装 Docker Engine（Ubuntu，由你本人执行）',
      commands: [
        '# 以下命令只展示，SHE 不会执行 sudo',
        'sudo apt-get update',
        'sudo apt-get install -y ca-certificates curl gnupg',
        'sudo install -m 0755 -d /etc/apt/keyrings',
        'sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc',
        'sudo chmod a+r /etc/apt/keyrings/docker.asc',
        'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null',
        'sudo apt-get update',
        'sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
        'sudo usermod -aG docker "$USER"',
        '# 退出并重新登录，然后验证；docker 组可能是 root-equivalent',
        'docker version',
      ],
      url: 'https://docs.docker.com/engine/install/ubuntu/',
      note: '需要管理员权限；SHE 不会执行这些命令。若不想使用 docker 组，可由你本人配置 rootless Docker。',
    }
  }
  if (id === 'debian' || like.includes('debian')) {
    return {
      title: '安装 Docker Engine（Debian，由你本人执行）',
      commands: [
        '# 以下命令只展示，SHE 不会执行 sudo',
        'sudo apt-get update',
        'sudo apt-get install -y ca-certificates curl gnupg',
        'sudo install -m 0755 -d /etc/apt/keyrings',
        'sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc',
        'sudo chmod a+r /etc/apt/keyrings/docker.asc',
        'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null',
        'sudo apt-get update',
        'sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
        'sudo usermod -aG docker "$USER"',
        'docker version',
      ],
      url: 'https://docs.docker.com/engine/install/debian/',
      note: '需要管理员权限；SHE 不会执行这些命令。',
    }
  }
  if (id === 'fedora') {
    return {
      title: '安装 Docker Engine（Fedora，由你本人执行）',
      commands: [
        '# 以下命令只展示，SHE 不会执行 sudo',
        'sudo dnf -y install dnf-plugins-core',
        'sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo',
        'sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
        'sudo systemctl enable --now docker',
        'sudo usermod -aG docker "$USER"',
        'docker version',
      ],
      url: 'https://docs.docker.com/engine/install/fedora/',
      note: '需要管理员权限；SHE 不会执行这些命令。',
    }
  }
  if (id === 'arch') {
    return {
      title: '安装 Docker（Arch Linux，由你本人执行）',
      commands: [
        'sudo pacman -S --needed docker',
        'sudo systemctl enable --now docker',
        'sudo usermod -aG docker "$USER"',
        'docker version',
      ],
      url: 'https://wiki.archlinux.org/title/Docker',
      note: '需要管理员权限；SHE 不会执行这些命令。',
    }
  }
  return {
    title: '按 Docker 官方文档安装',
    commands: ['# 由你本人按发行版选择 Docker Engine 安装方式', '# https://docs.docker.com/engine/install/', 'docker version'],
    url: 'https://docs.docker.com/engine/install/',
    note: 'SHE 不会执行 sudo，也不会请求 root。安装完成后确认当前用户执行 `docker version` 成功。',
  }
}
