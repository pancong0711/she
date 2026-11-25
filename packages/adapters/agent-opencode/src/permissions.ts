/**
 * Fixed OpenCode permission baseline for SHE executor sessions.
 *
 * These rules are defense-in-depth, not an OS sandbox. In particular,
 * `external_directory` gates file-oriented tools but does not constrain shell
 * redirection. Strong isolation must come from the sandbox/broker layer.
 */

export interface OpenCodePermissionRule {
  readonly action: string
  readonly resource: string
  readonly effect: 'allow' | 'deny' | 'ask'
}

export const SHE_OPENCODE_PERMISSION_RULES: readonly OpenCodePermissionRule[] = [
  { action: '*', resource: '*', effect: 'allow' },
  { action: 'external_directory', resource: '*', effect: 'deny' },
  { action: 'webfetch', resource: '*', effect: 'deny' },
  { action: 'websearch', resource: '*', effect: 'deny' },
  { action: 'subagent', resource: '*', effect: 'deny' },
  { action: 'task', resource: '*', effect: 'deny' },
  { action: 'read', resource: '*.env', effect: 'deny' },
  { action: 'read', resource: '*.env.*', effect: 'deny' },
  { action: 'read', resource: '*.pem', effect: 'deny' },
  { action: 'read', resource: '*.key', effect: 'deny' },
  { action: 'shell', resource: '*sudo *', effect: 'deny' },
  { action: 'shell', resource: '*rm -rf *', effect: 'deny' },
  { action: 'shell', resource: '*git commit*', effect: 'deny' },
  { action: 'shell', resource: '*git push*', effect: 'deny' },
  { action: 'shell', resource: '*git merge*', effect: 'deny' },
  { action: 'shell', resource: '*git reset --hard*', effect: 'deny' },
  { action: 'shell', resource: '*git clean *', effect: 'deny' },
  { action: 'shell', resource: '*npm install*', effect: 'deny' },
  { action: 'shell', resource: '*npm i *', effect: 'deny' },
  { action: 'shell', resource: '*pnpm add*', effect: 'deny' },
  { action: 'shell', resource: '*yarn add*', effect: 'deny' },
]
