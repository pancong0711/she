/** Pure preflight classification helpers (no filesystem or process access). */

export function dockerGuidance(commandResult, platform = process.platform) {
  const detail = String(commandResult?.stderr ?? '')
  if (/ENOENT|command not found/i.test(detail)) {
    return {
      detail: 'docker 命令不存在或不在 PATH 中；Sandbox、Agent Migration 和 broker 容器能力不可用。',
      remediation: platform === 'darwin'
        ? '安装并启动 Docker Desktop，确认终端执行 `docker version` 成功；SHE 不会代你安装或请求 root。'
        : platform === 'win32'
          ? '安装并启动 Docker Desktop（启用 WSL2 backend），确认 PowerShell 执行 `docker version` 成功；SHE 不会代你安装或请求 root。'
          : '推荐由你本人安装 rootless Docker（参考 https://docs.docker.com/engine/security/rootless/），确认 `docker info` 显示 rootless。不要把当前用户加入 root 权限的 docker 组；SHE 不会代你安装 Docker，也不会执行 sudo。',
    }
  }
  if (/permission denied|access denied/i.test(detail)) {
    return {
      detail: 'Docker 已安装，但当前用户没有访问 Docker daemon 的权限。',
      remediation: '请由你本人配置并使用 rootless Docker。不要把当前用户加入 root docker 组；docker 组权限可能是 root-equivalent，SHE 不会执行 sudo。',
    }
  }
  if (/cannot connect|is the docker daemon running|connection refused/i.test(detail)) {
    return {
      detail: 'Docker CLI 存在，但 Docker daemon 未运行或 socket 不可达。',
      remediation: '启动 Docker Desktop / Docker daemon（或 rootless Docker）后，重新点击“环境检查”。SHE 不会启动系统服务或请求 root。',
    }
  }
  return {
    detail: `Docker 运行时不可用：${detail || 'unknown error'}`,
    remediation: '由你本人安装/启动 Docker 并确认 `docker version` 在当前用户下可用；SHE 不执行 sudo，不请求 root。',
  }
}

export function summarizePreflight(checks, dockerAvailable) {
  const failures = checks.filter(check => check.status === 'fail')
  const warnings = checks.filter(check => check.status === 'warn')
  const persistenceReady = !warnings.some(check => check.feature === 'persistence')
  return {
    failures,
    warnings,
    ok: failures.length === 0,
    sandboxReady: dockerAvailable === true,
    persistenceReady,
    summary: {
      requiredReady: failures.length === 0,
      sandboxReady: dockerAvailable === true,
      persistenceReady,
      warnings: warnings.length,
      failures: failures.length,
    },
  }
}
