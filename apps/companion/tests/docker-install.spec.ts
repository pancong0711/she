import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { dockerInstallGuide } from '../docker-install.mjs'

describe('docker install guidance', () => {
  it('provides concrete Ubuntu commands without executing them', () => {
    const guide = dockerInstallGuide('linux', { ID: 'ubuntu', VERSION_CODENAME: 'jammy' })
    expect(guide.commands.join('\n')).toContain('download.docker.com/linux/ubuntu')
    expect(guide.commands.join('\n')).toContain('docker version')
    expect(guide.note).toContain('不会执行')
  })

  it('provides Docker Desktop commands for macOS and Windows', () => {
    expect(dockerInstallGuide('darwin', {}).commands.join('\n')).toContain('docs.docker.com/desktop')
    const win = dockerInstallGuide('win32', {})
    expect(win.commands.join('\n')).toContain('winget install --id Docker.DockerDesktop')
    expect(win.commands.join('\n')).toContain('WSL2')
  })
})
