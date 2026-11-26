import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { dockerInstallGuide } from '../docker-install.mjs'

describe('docker install guidance', () => {
  it('provides rootless Ubuntu commands and per-line explanations', () => {
    const guide = dockerInstallGuide('linux', { ID: 'ubuntu', VERSION_CODENAME: 'jammy' })
    const commands = guide.commands.join('\n')
    expect(commands).toContain('docker-ce-rootless-extras')
    expect(commands).not.toContain('curl -fsSL https://get.docker.com/rootless | sh')
    expect(commands).toContain('dockerd-rootless-setuptool.sh install')
    expect(commands).toContain('docker context use rootless')
    expect(commands).toContain('docker info')
    expect(commands).not.toContain('usermod -aG docker')
    expect(guide.steps.every(step => typeof step.explanation === 'string' && step.explanation.length > 0)).toBe(true)
    expect(guide.note).toContain('不要把当前用户加入 docker 组')
    expect(guide.alternatives.length).toBeGreaterThanOrEqual(3)
    const aliyun = guide.alternatives.find(item => item.label.includes('阿里云'))
    expect(aliyun?.steps.map(step => step.command).join('\n')).toContain('mirrors.aliyun.com/docker-ce/linux/ubuntu')
    expect(aliyun?.steps.map(step => step.explanation).join('\n')).toContain('9DC858229FC7DD38854AE2D88D81803C0EBFCD88')
  })

  it('provides Docker Desktop steps for macOS and Windows', () => {
    expect(dockerInstallGuide('darwin', {}).commands.join('\n')).toContain('docker version')
    const win = dockerInstallGuide('win32', {})
    expect(win.commands.join('\n')).toContain('winget install --id Docker.DockerDesktop')
    expect(win.steps.map(step => step.explanation).join('\n')).toContain('WSL2')
    expect(win.commands.join('\n')).not.toContain('usermod')
  })
})
