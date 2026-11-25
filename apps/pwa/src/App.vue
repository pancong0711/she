<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HelpPanel from './components/HelpPanel.vue'
import type { GatewayHealth, GatewaySnapshot, SandboxBrokerHealth, SandboxStats, SandboxView } from '@she/protocol'
import {
  BROKER_COMMANDS,
  COMPANION_BUNDLE_URL,
  COMPANION_INSTALLER_URL,
  COMPANION_MANIFEST_URL,
  COMPANION_RELEASE_URL,
  DEFAULT_CORE_MANIFEST_URL,
  INSTALL_COMMANDS,
  REPO_URL,
  checkCoreUpdate,
  coreAction,
  getCompanionUrl,
  isLocalOrigin,
  loadCompanionHealth,
  loadCoreStatus,
  loadPackages,
  loadSandboxStats,
  loadSandboxes,
  loadSnapshot,
  setCompanionUrl,
  startJob,
  streamJobEvents,
  type CompanionHealth,
  type CoreStatus,
  type CoreUpdateCheck,
  type JobEvent,
  type JobSummary,
  type PackageInfo,
} from './api'

type Tab = 'dashboard' | 'tasks' | 'sandboxes' | 'setup' | 'packages' | 'gateway' | 'settings' | 'help'

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'sandboxes', label: 'Sandboxes' },
  { id: 'setup', label: 'Install & Doctor' },
  { id: 'packages', label: 'Packages' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'settings', label: 'Settings' },
  { id: 'help', label: 'Help' },
]

const active = ref<Tab>('dashboard')
const health = ref<GatewayHealth | null>(null)
const snapshot = ref<GatewaySnapshot | null>(null)
const sandboxes = ref<readonly SandboxView[]>([])
const brokerHealth = ref<SandboxBrokerHealth | null>(null)
const sandboxStats = ref<Record<string, SandboxStats>>({})
const sandboxError = ref('')
const loadingStats = ref('')
const error = ref('')
const loading = ref(false)
const companion = ref<CompanionHealth | null>(null)
const companionError = ref('')
const remoteMode = !isLocalOrigin()
const companionUrl = ref(getCompanionUrl())
const copied = ref(false)
const job = ref<JobSummary | null>(null)
const jobEvents = ref<JobEvent[]>([])
const jobRunning = ref(false)
const jobError = ref('')
const jobKind = ref('')
const coreStatus = ref<CoreStatus | null>(null)
const coreError = ref('')
const coreActionRunning = ref('')
const coreManifestUrl = ref(DEFAULT_CORE_MANIFEST_URL)
const coreUpdateCheck = ref<CoreUpdateCheck | null>(null)
const coreUpdateError = ref('')
const packages = ref<readonly PackageInfo[]>([])
const packageError = ref('')
let timer: ReturnType<typeof setInterval> | undefined

const iconUrl = `${import.meta.env.BASE_URL}icons/she.svg`
const tasks = computed(() => [...(snapshot.value?.tasks ?? [])].reverse())
const runningTasks = computed(() => tasks.value.filter(task => ['dispatching', 'submitted', 'running'].includes(task.status)).length)
const failedTasks = computed(() => tasks.value.filter(task => ['failed', 'needs_attention'].includes(task.status)).length)
const online = computed(() => health.value?.status === 'ok')
const brokerOnline = computed(() => brokerHealth.value?.status === 'ok')
const companionOnline = computed(() => companion.value !== null)

async function refresh(): Promise<void> {
  loading.value = true
  const [snapshotResult, sandboxResult, companionResult, coreStatusResult, packageResult] = await Promise.allSettled([
    loadSnapshot(),
    loadSandboxes(),
    loadCompanionHealth(),
    loadCoreStatus(),
    loadPackages(),
  ])
  if (snapshotResult.status === 'fulfilled') {
    health.value = snapshotResult.value.health
    snapshot.value = snapshotResult.value.snapshot
    error.value = ''
  } else {
    health.value = null
    snapshot.value = null
    error.value = snapshotResult.reason instanceof Error ? snapshotResult.reason.message : String(snapshotResult.reason)
  }
  if (sandboxResult.status === 'fulfilled') {
    brokerHealth.value = sandboxResult.value.health
    sandboxes.value = sandboxResult.value.sandboxes
    sandboxError.value = ''
  } else {
    brokerHealth.value = null
    sandboxes.value = []
    sandboxError.value = sandboxResult.reason instanceof Error ? sandboxResult.reason.message : String(sandboxResult.reason)
  }
  if (companionResult.status === 'fulfilled') {
    companion.value = companionResult.value
    companionError.value = ''
  } else {
    companion.value = null
    companionError.value = companionResult.reason instanceof Error ? companionResult.reason.message : String(companionResult.reason)
  }
  if (coreStatusResult.status === 'fulfilled') {
    coreStatus.value = coreStatusResult.value
    coreError.value = ''
  } else {
    coreStatus.value = null
    coreError.value = coreStatusResult.reason instanceof Error ? coreStatusResult.reason.message : String(coreStatusResult.reason)
  }
  if (packageResult.status === 'fulfilled') {
    packages.value = packageResult.value
    packageError.value = ''
  } else {
    packages.value = []
    packageError.value = packageResult.reason instanceof Error ? packageResult.reason.message : String(packageResult.reason)
  }
  loading.value = false
}

async function connectCompanion(): Promise<void> {
  setCompanionUrl(companionUrl.value)
  await refresh()
}

async function copyInstallCommands(): Promise<void> {
  try {
    await navigator.clipboard.writeText(INSTALL_COMMANDS.join('\n'))
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch {
    copied.value = false
  }
}

async function runCoreAction(action: 'start' | 'stop' | 'restart'): Promise<void> {
  if (coreActionRunning.value !== '') return
  coreActionRunning.value = action
  coreError.value = ''
  try {
    coreStatus.value = await coreAction(action)
    await refresh()
  } catch (cause) {
    coreError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    coreActionRunning.value = ''
  }
}

async function runCoreUpdateCheck(): Promise<void> {
  coreUpdateError.value = ''
  coreUpdateCheck.value = null
  try {
    coreUpdateCheck.value = await checkCoreUpdate(coreManifestUrl.value)
  } catch (cause) {
    coreUpdateError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function applyCoreUpdate(): Promise<void> {
  coreUpdateError.value = ''
  await runJob('core-update', { manifestUrl: coreManifestUrl.value })
  await refresh()
}

async function loadStats(name: string): Promise<void> {
  loadingStats.value = name
  try {
    const stats = await loadSandboxStats(name)
    if (stats !== undefined) sandboxStats.value = { ...sandboxStats.value, [name]: stats }
  } catch (cause) {
    sandboxError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loadingStats.value = ''
  }
}

async function runJob(kind: string, options: Readonly<Record<string, unknown>> = {}): Promise<void> {
  if (jobRunning.value) return
  jobRunning.value = true
  jobKind.value = kind
  jobError.value = ''
  jobEvents.value = []
  try {
    const started = await startJob(kind, options)
    job.value = started
    for await (const event of streamJobEvents(started.id)) {
      jobEvents.value.push(event)
      if (event.type === 'done') break
    }
    await refresh()
  } catch (cause) {
    jobError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    jobRunning.value = false
    jobKind.value = ''
  }
}

function jobEventText(event: JobEvent): string {
  if (event.type === 'log') return event.text
  if (event.type === 'system') return event.text
  if (event.type === 'check') return `[${event.status}] ${event.label}: ${event.detail}`
  if (event.type === 'status') return `status: ${event.status}`
  return `done: ${event.status} (exit ${String(event.exitCode)})`
}

function relativeTime(at?: number): string {
  if (at === undefined) return '-'
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return `${String(seconds)}s ago`
  if (seconds < 3600) return `${String(Math.round(seconds / 60))}m ago`
  return `${String(Math.round(seconds / 3600))}h ago`
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '-'
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 5000)
})
onBeforeUnmount(() => {
  if (timer !== undefined) clearInterval(timer)
})
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <img :src="iconUrl" alt="SHE" />
        <div>
          <strong>SHE</strong>
          <span>agent control plane</span>
        </div>
      </div>
      <nav>
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="{ active: active === tab.id }"
          @click="active = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>
      <div class="sidebar-foot">
        <span :class="['dot', companionOnline ? 'ok' : 'bad']"></span>
        companion {{ companionOnline ? 'online' : 'offline' }}
      </div>
      <div class="sidebar-foot broker-foot">
        <span :class="['dot', brokerOnline ? 'ok' : 'bad']"></span>
        broker {{ brokerOnline ? 'online' : 'offline' }}
      </div>
      <div class="sidebar-foot broker-foot">
        <span :class="['dot', online ? 'ok' : 'bad']"></span>
        control {{ online ? 'online' : 'offline' }}
      </div>
      <a class="repo-link" :href="REPO_URL" target="_blank" rel="noreferrer">GitHub 仓库 ↗</a>
    </aside>

    <main>
      <header>
        <div>
          <h1>{{ tabs.find(tab => tab.id === active)?.label }}</h1>
          <p>
            {{ remoteMode ? 'GitHub Pages PWA' : 'Local companion' }} ·
            gateway.v1 · {{ health?.version ?? 'offline' }}
          </p>
        </div>
        <button class="refresh" :disabled="loading" @click="refresh">
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </button>
      </header>

      <section v-if="active === 'dashboard'" class="dashboard-page">
        <div v-if="!health" class="card offline-card">
          <p class="eyebrow">CONTROL PLANE OFFLINE</p>
          <h2>{{ companionOnline ? 'Companion 在线，但控制面还没启动' : '先启动 SHE companion' }}</h2>
          <p class="muted">
            {{ companionOnline
              ? '可以进入 Install & Doctor 检查环境并启动/修复服务。'
              : 'GitHub Pages 只是静态 PWA。安装、sandbox、agent 和本地控制面都在你的电脑上运行。' }}
          </p>
          <div class="hero-actions">
            <button class="primary" @click="active = 'setup'">打开 Install & Doctor</button>
            <a class="secondary" :href="REPO_URL" target="_blank" rel="noreferrer">打开 GitHub 仓库</a>
          </div>
          <p v-if="error" class="error-text">错误：{{ error }}</p>
        </div>

        <div v-else class="grid">
          <article class="card metric">
            <span>Tasks</span>
            <strong>{{ tasks.length }}</strong>
            <small>{{ runningTasks }} active · {{ failedTasks }} attention</small>
          </article>
          <article class="card metric">
            <span>Protocol</span>
            <strong>{{ health.protocolVersion }}</strong>
            <small>capabilities: {{ health.capabilities.values.length }}</small>
          </article>
          <article class="card metric">
            <span>Snapshot</span>
            <strong>{{ snapshot?.cursor ?? 'empty' }}</strong>
            <small>generated {{ relativeTime(snapshot?.generatedAt) }}</small>
          </article>
          <article class="card metric">
            <span>Sandboxes</span>
            <strong>{{ sandboxes.length }}</strong>
            <small>{{ sandboxes.filter(item => item.status === 'running').length }} running</small>
          </article>
          <article class="card wide">
            <h2>Recent tasks</h2>
            <p v-if="tasks.length === 0" class="muted">No tasks yet. Submit via `/she submit` or CLI.</p>
            <ul v-else class="task-list">
              <li v-for="task in tasks.slice(0, 8)" :key="task.taskId">
                <span :class="['pill', task.status]">{{ task.status }}</span>
                <div>
                  <strong>{{ task.excerpt }}</strong>
                  <small>#{{ task.seq }} · {{ task.taskId }} · {{ relativeTime(task.updatedAt) }}</small>
                </div>
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section v-else-if="active === 'tasks'" class="card">
        <div v-if="!health" class="offline-card compact">
          <h2>Tasks 需要控制面</h2>
          <p class="muted">先连接 companion 并启动 control plane。</p>
          <button class="primary" @click="active = 'setup'">打开 Install & Doctor</button>
        </div>
        <template v-else>
          <h2>Task snapshot</h2>
          <p class="muted">Read-only snapshot. Live task events are available through the control-plane event stream.</p>
          <table>
            <thead><tr><th>Status</th><th>Task</th><th>Priority</th><th>Updated</th></tr></thead>
            <tbody>
              <tr v-for="task in tasks" :key="task.taskId">
                <td><span :class="['pill', task.status]">{{ task.status }}</span></td>
                <td><strong>{{ task.excerpt }}</strong><br /><small>{{ task.taskId }}</small></td>
                <td>{{ task.priority }}</td>
                <td>{{ relativeTime(task.updatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>

      <section v-else-if="active === 'sandboxes'" class="sandbox-page">
        <div v-if="sandboxError" class="alert">
          <strong>Sandbox broker 不可用</strong>
          <p>{{ sandboxError }}</p>
          <pre><code>{{ BROKER_COMMANDS.join('\n') }}</code></pre>
          <button class="primary" @click="active = 'setup'">打开 Install & Doctor</button>
        </div>
        <div class="card">
          <div class="section-head">
            <div>
              <h2>Sandboxes</h2>
              <p class="muted">
                {{ brokerHealth ? `broker ${brokerHealth.status} · ${brokerHealth.version}` : 'broker offline' }}
              </p>
            </div>
            <button class="secondary" :disabled="loading" @click="refresh">Refresh</button>
          </div>
          <p v-if="sandboxes.length === 0" class="muted">还没有 sandbox。后续将从安装向导或 Sandboxes 页面创建 main sandbox。</p>
          <div v-else class="sandbox-grid">
            <article v-for="sandbox in sandboxes" :key="sandbox.name" class="sandbox-card">
              <div class="sandbox-head">
                <div>
                  <strong>{{ sandbox.name }}</strong>
                  <small>{{ sandbox.agentId }} · {{ sandbox.role }}</small>
                </div>
                <span :class="['pill', sandbox.status]">{{ sandbox.status }}</span>
              </div>
              <div class="sandbox-meta">
                <span>health <b>{{ sandbox.health ?? 'unknown' }}</b></span>
                <span>image <b>{{ sandbox.image ?? '-' }}</b></span>
                <span>started <b>{{ relativeTime(sandbox.startedAt) }}</b></span>
              </div>
              <div v-if="sandboxStats[sandbox.name]" class="sandbox-stats">
                <span>CPU <b>{{ sandboxStats[sandbox.name]?.cpuPercent?.toFixed(1) ?? '-' }}%</b></span>
                <span>MEM <b>{{ formatBytes(sandboxStats[sandbox.name]?.memoryBytes) }}</b></span>
                <span>PIDs <b>{{ sandboxStats[sandbox.name]?.pids ?? '-' }}</b></span>
              </div>
              <button class="secondary stats-button" :disabled="loadingStats === sandbox.name" @click="loadStats(sandbox.name)">
                {{ loadingStats === sandbox.name ? 'Loading…' : 'Load stats' }}
              </button>
            </article>
          </div>
        </div>
      </section>

      <section v-else-if="active === 'setup'" class="setup-page">
        <div v-if="!companion" class="onboarding">
          <div class="hero card">
            <div class="hero-icon">S</div>
            <div>
              <p class="eyebrow">LOCAL-FIRST AGENT CONTROL PLANE</p>
              <h2>先把 SHE companion 跑起来</h2>
              <p class="muted">
                GitHub Pages 上的是静态 PWA。安装、sandbox、agent、软件包和本地控制面都在你的电脑上运行；
                浏览器通过 <code>127.0.0.1</code> 连接本机 companion。
              </p>
              <div class="hero-actions">
                <a class="primary" :href="REPO_URL" target="_blank" rel="noreferrer">打开 GitHub 仓库</a>
                <a class="secondary" href="https://github.com/pancong0711/she#readme" target="_blank" rel="noreferrer">查看安装说明</a>
              </div>
            </div>
          </div>

          <div class="steps">
            <article class="card step">
              <span class="step-no">01</span>
              <h3>获取 SHE</h3>
              <p>克隆仓库或下载 GitHub Release。</p>
            </article>
            <article class="card step">
              <span class="step-no">02</span>
              <h3>启动本地 companion</h3>
              <p>运行 PWA host，它会把控制面和 broker API 暴露给这个页面。</p>
            </article>
            <article class="card step">
              <span class="step-no">03</span>
              <h3>连接并开始使用</h3>
              <p>保持 companion 运行，然后点击环境检查、安装依赖、构建 PWA。</p>
            </article>
          </div>

          <div class="card download-card">
            <h3>下载安装包</h3>
            <p class="muted">首次使用需要在电脑上运行一次安装脚本。安装器和 bundle 均可校验 SHA-256，且不请求 root。</p>
            <div class="hero-actions">
              <a class="primary" href="./start.bat" download>Windows 一键启动 start.bat</a>
              <a class="primary" href="./start.command" download>macOS 一键启动 start.command</a>
              <a class="secondary" href="./start.sh" download>macOS/Linux start.sh</a>
              <a class="secondary" :href="COMPANION_INSTALLER_URL" target="_blank" rel="noreferrer">高级：install-companion.sh</a>
            </div>
            <p class="muted small-note">
              <a :href="COMPANION_BUNDLE_URL" target="_blank" rel="noreferrer">bundle</a> ·
              <a :href="COMPANION_MANIFEST_URL" target="_blank" rel="noreferrer">SHA/manifest</a> ·
              <a :href="COMPANION_RELEASE_URL" target="_blank" rel="noreferrer">Release</a>
            </p>
            <p class="muted small-note">
              安装命令（示例，具体 SHA 以 manifest 为准）：<br />
              <code>bash install-companion.sh she-companion-0.1.0.tar.gz --sha256 &lt;hash&gt;</code>
            </p>
            <a class="repo-link" :href="COMPANION_RELEASE_URL" target="_blank" rel="noreferrer">Release 页面 ↗</a>
          </div>

          <div class="card install-card">
            <div class="install-head">
              <div>
                <h3>本机启动命令</h3>
                <p class="muted">需要 Node.js 22.19+ 与 pnpm 11.22+。首次启动仍需要一次本机操作。</p>
              </div>
              <button class="secondary" @click="copyInstallCommands">{{ copied ? '已复制' : '复制命令' }}</button>
            </div>
            <pre><code>{{ INSTALL_COMMANDS.join('\n') }}</code></pre>
          </div>

          <div class="card connect-card">
            <h3>连接本地 companion</h3>
            <div class="connect-row">
              <input v-model="companionUrl" placeholder="http://127.0.0.1:8787" />
              <button class="primary" :disabled="loading" @click="connectCompanion">连接</button>
            </div>
            <p v-if="companionError" class="error-text">连接失败：{{ companionError }}</p>
          </div>
        </div>

        <div v-else class="setup-grid">
          <div class="card companion-card">
            <p class="eyebrow">COMPANION ONLINE</p>
            <h2>安装、调试与环境检查</h2>
            <div class="health-grid">
              <div><span>PID</span><b>{{ companion.pid }}</b></div>
              <div><span>版本</span><b>{{ companion.version }}</b></div>
              <div><span>repo</span><b>{{ companion.repoRoot }}</b></div>
              <div><span>control socket</span><b>{{ companion.controlSocketPath }}</b></div>
              <div><span>broker socket</span><b>{{ companion.brokerSocketPath }}</b></div>
            </div>
            <div class="job-actions">
              <button class="primary" :disabled="jobRunning" @click="runJob('doctor')">环境检查</button>
              <button class="secondary" :disabled="jobRunning" @click="runJob('bootstrap')">用户级环境准备（不请求 root）</button>
              <button class="secondary" :disabled="jobRunning" @click="runJob('install')">安装依赖（自动预检）</button>
              <button class="secondary" :disabled="jobRunning" @click="runJob('build')">构建 PWA</button>
              <button class="secondary" :disabled="jobRunning" @click="runJob('build-all')">构建全部</button>
              <button class="secondary" :disabled="jobRunning" @click="runJob('test')">运行测试</button>
            </div>
            <p v-if="jobError" class="error-text">{{ jobError }}</p>
            <p v-if="job" class="muted">last job: {{ job.kind }} · {{ job.status }} · {{ job.id }}</p>
          </div>

          <div class="card core-card">
            <p class="eyebrow">CORE RUNTIME</p>
            <h2>Core 版本与更新</h2>
            <p v-if="coreError" class="error-text">{{ coreError }}</p>
            <div class="health-grid">
              <div><span>supervisor</span><b>{{ coreStatus?.supervisor.state ?? 'unknown' }}</b></div>
              <div><span>pid</span><b>{{ coreStatus?.supervisor.pid ?? '-' }}</b></div>
              <div><span>current</span><b>{{ coreStatus?.installed.current ?? 'not installed' }}</b></div>
              <div><span>previous</span><b>{{ coreStatus?.installed.previous ?? '-' }}</b></div>
              <div><span>control</span><b>{{ coreStatus?.controlPlane.reachable ? 'reachable' : 'offline' }}</b></div>
              <div><span>broker</span><b>{{ coreStatus?.broker.reachable ? 'reachable' : 'offline' }}</b></div>
              <div><span>last update</span><b>{{ coreStatus?.lastUpdate?.status ?? '-' }}</b></div>
            </div>
            <div class="job-actions">
              <button class="secondary" :disabled="coreActionRunning !== ''" @click="runCoreAction('start')">{{ coreActionRunning === 'start' ? 'Starting…' : '启动 core' }}</button>
              <button class="secondary" :disabled="coreActionRunning !== ''" @click="runCoreAction('stop')">{{ coreActionRunning === 'stop' ? 'Stopping…' : '停止 core' }}</button>
              <button class="secondary" :disabled="coreActionRunning !== ''" @click="runCoreAction('restart')">{{ coreActionRunning === 'restart' ? 'Restarting…' : '重启 core' }}</button>
            </div>
            <label for="core-manifest">Release manifest URL</label>
            <div class="connect-row">
              <input id="core-manifest" v-model="coreManifestUrl" placeholder="https://…/release-manifest.json" />
              <button class="secondary" :disabled="jobRunning" @click="runCoreUpdateCheck">检查更新</button>
            </div>
            <p v-if="coreUpdateError" class="error-text">{{ coreUpdateError }}</p>
            <div v-if="coreUpdateCheck" class="update-check">
              <p>当前：<b>{{ coreUpdateCheck.current ?? '未安装' }}</b> · 可用：<b>{{ coreUpdateCheck.available ?? 'unknown' }}</b></p>
              <p v-if="!coreUpdateCheck.needsUpdate" class="muted">已是最新版本。</p>
              <button v-else class="primary" :disabled="jobRunning" @click="applyCoreUpdate">应用 core 更新</button>
            </div>
            <p class="muted small-note">
              更新流程会下载并校验 bundle，停止旧 core，切换 current，启动新 core，并做 health check；
              失败时自动尝试回滚到 previous。全过程日志显示在右侧面板。
              companion 自身不会由 core 更新替换；companion 升级必须使用新的 checksum-verified 安装器和 release。
            </p>
          </div>

          <div class="card console-card">
            <div class="console-head">
              <h2>实时安装/调试日志</h2>
              <span :class="['pill', jobRunning ? 'running' : job?.status ?? 'stopped']">
                {{ jobRunning ? `${jobKind} running` : job?.status ?? 'idle' }}
              </span>
            </div>
            <p v-if="jobEvents.length === 0" class="muted">点击左侧按钮后，命令输出会实时显示在这里。</p>
            <pre v-else class="job-console"><code><div v-for="(event, index) in jobEvents" :key="index" :class="['job-line', event.type, event.type === 'check' ? event.status : '']">{{ jobEventText(event) }}</div></code></pre>
          </div>

          <div class="card wide-card policy-note">
            <h3>Root / sudo 策略</h3>
            <p>
              SHE companion 不执行 sudo，不申请 root，也不会自动安装需要特权的系统组件。
              “用户级环境准备”只会在当前用户目录安装 pnpm 等无需管理员权限的组件。
              如果环境检查提示 Docker/rootless Docker/系统依赖需要管理员权限，请由用户自己按官方说明完成；
              完成后再回到这里点击“环境检查”。
            </p>
            <p class="muted">
              SHE 自身、control plane、broker、agent 和 sandbox 数据都应在当前普通用户下运行。
              Docker 访问若依赖 docker 组，可能是 root-equivalent，SHE 会显示 warning，不把它伪装成 rootless 安全边界。
            </p>
          </div>

          <div class="card wide-card">
            <h3>当前限制</h3>
            <p class="muted">
              当前 PWA 可以触发已白名单化的本地检查、依赖安装、构建和测试，并实时显示日志。
              软件包目录、系统级安装/更新、启动/停止 systemd 服务与回滚将在 T6.4 继续接入。
            </p>
            <pre><code>{{ BROKER_COMMANDS.join('\n') }}</code></pre>
          </div>
        </div>
      </section>

      <section v-else-if="active === 'packages'" class="packages-page">
        <div v-if="packageError" class="alert">
          <strong>Package catalog 不可用</strong>
          <p>{{ packageError }}</p>
        </div>
        <div class="card">
          <div class="section-head">
            <div>
              <h2>软件包与运行时</h2>
              <p class="muted">只读清单 + 已支持的用户级操作。系统级安装只提供方法，不请求 root。</p>
            </div>
            <button class="secondary" :disabled="loading" @click="refresh">Refresh</button>
          </div>
          <div class="package-grid">
            <article v-for="item in packages" :key="item.id" class="package-card">
              <div class="sandbox-head">
                <div>
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.kind }} · {{ item.management }}</small>
                </div>
                <span class="pill">{{ item.state }}</span>
              </div>
              <div class="sandbox-meta">
                <span>installed <b>{{ item.installedVersion ?? 'not installed' }}</b></span>
                <span v-if="item.previousVersion">previous <b>{{ item.previousVersion }}</b></span>
              </div>
              <p class="muted small-note">{{ item.note }}</p>
              <div v-if="item.management === 'launcher'" class="package-actions">
                <a class="secondary" href="./start.bat" download>Windows launcher</a>
                <a class="secondary" href="./start.command" download>macOS launcher</a>
                <a class="secondary" href="./start.sh" download>Linux launcher</a>
              </div>
              <div v-else-if="item.management === 'core-update'" class="package-actions">
                <button class="primary" @click="active = 'setup'">打开 Core 更新</button>
              </div>
              <div v-else-if="item.management === 'bootstrap'" class="package-actions">
                <button class="primary" :disabled="jobRunning" @click="runJob('bootstrap')">用户级准备 pnpm</button>
              </div>
              <div v-else class="package-actions">
                <span class="muted small-note">需要管理员权限的安装步骤由用户本人完成；SHE 不执行 sudo。</span>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section v-else-if="active === 'settings'" class="card settings-card">
        <h2>本地 companion</h2>
        <p class="muted">当前页面通过 companion 访问本机 SHE control plane 和 sandbox broker。</p>
        <label for="companion">Companion URL</label>
        <div class="connect-row">
          <input id="companion" v-model="companionUrl" placeholder="http://127.0.0.1:8787" />
          <button class="primary" :disabled="loading" @click="connectCompanion">保存并测试</button>
        </div>
        <div class="status-box">
          <span :class="['dot', companionOnline ? 'ok' : 'bad']"></span>
          <span>companion {{ companionOnline ? '已连接' : '未连接' }}</span>
          <span :class="['dot', online ? 'ok' : 'bad']"></span>
          <span>control {{ online ? '已连接' : '未连接' }}</span>
          <span :class="['dot', brokerOnline ? 'ok' : 'bad']"></span>
          <span>broker {{ brokerOnline ? '已连接' : '未连接' }}</span>
        </div>
        <p v-if="companionError" class="error-text">{{ companionError }}</p>
        <p class="muted">
          普通用户应优先直接打开 <code>http://127.0.0.1:8787</code>，同源模式无需额外配置 CORS。
        </p>
      </section>

      <section v-else-if="active === 'help'">
        <HelpPanel
          :companion-version="companion?.version ?? 'offline'"
          :control-version="health?.version ?? 'offline'"
          :broker-version="brokerHealth?.version ?? 'offline'"
        />
      </section>

      <section v-else class="placeholder card">
        <div class="placeholder-icon">◌</div>
        <h2>{{ tabs.find(tab => tab.id === active)?.label }} 页面待接入</h2>
        <p>该模块已纳入 M6；后续将接入软件包目录、workspace 权限和 agent 对话。</p>
        <p class="muted">当前可使用 Install & Doctor 检查环境、安装依赖、构建并查看实时日志。</p>
      </section>
    </main>
  </div>
</template>
