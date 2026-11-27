import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { buildLaunchAgentPlist, buildSystemdUnit, buildWindowsStartupCmd } from '../autostart.mjs'

const options = {
  installRoot: '/home/user/.local/share/she/companion',
  binDir: '/home/user/.local/bin',
  execPath: '/usr/bin/node',
  port: 8787,
}

describe('companion autostart templates', () => {
  it('builds a user systemd unit without root', () => {
    const unit = buildSystemdUnit(options)
    expect(unit).toContain('SHE_PWA_PORT=8787')
    expect(unit).toContain('/home/user/.local/share/she/companion')
    expect(unit).toContain('launcher.mjs')
    expect(unit).toContain('WantedBy=default.target')
    expect(unit).not.toContain('User=root')
  })

  it('builds launchd and Windows startup artifacts', () => {
    expect(buildLaunchAgentPlist(options)).toContain('dev.she.companion')
    expect(buildWindowsStartupCmd(options)).toContain('launcher.mjs')
    expect(buildWindowsStartupCmd(options)).toContain('SHE_COMPANION_ROOT')
  })
})
