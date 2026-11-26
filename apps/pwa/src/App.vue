<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HelpPanel from './components/HelpPanel.vue'
import AgentMigrationPanel from './components/AgentMigrationPanel.vue'
import WorkspaceAuthorizationPanel from './components/WorkspaceAuthorizationPanel.vue'
import type { AgentRuntimeStatus, GatewayHealth, GatewayServerEvent, GatewaySnapshot, RenderIntent, SandboxBrokerHealth, SandboxStats, SandboxView } from '@she/protocol'
import {
  BROKER_COMMANDS,
  COMPANION_BUNDLE_URL,
  COMPANION_MIN_VERSION,
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
  loadAgentRuntime,
  loadCompanionHealth,
  loadCoreStatus,
  loadPackages,
  loadPlatformStatus,
  loadPreflight,
  loadSandboxStats,
  loadSandboxes,
  loadSnapshot,
  loadWorkerConfig,
  saveWorkerConfig,
  sendTaskToShe,
  setCompanionUrl,
  isVersionOlder,
  startJob,
  streamJobEvents,
  subscribeGatewayEvents,
  type CompanionHealth,
  type CoreStatus,
  type CoreUpdateCheck,
  type JobEvent,
  type JobSummary,
  type PackageInfo,
  type PackageInstallInfo,
  type PlatformStatus,
  type PreflightResult,
  type WorkerConfig,
} from './api'

type Tab = 'dashboard' | 'tasks' | 'agents' | 'workspaces' | 'sandboxes' | 'chat' | 'migrate' | 'setup' | 'packages' | 'gateway' | 'settings' | 'help'

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'agents', label: 'Agents' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'sandboxes', label: 'Sandboxes' },
  { id: 'chat', label: 'Chat' },
  { id: 'migrate', label: 'Agent Migration' },
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
const agentRuntime = ref<AgentRuntimeStatus | null>(null)
const agentRuntimeError = ref('')
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

interface ChatMessage { id: string; role: 'user' | 'assistant' | 'system'; text: string; at: number }
const chatMessages = ref<ChatMessage[]>([])
const chatInput = ref('')
const chatSending = ref(false)
const chatError = ref('')
const chatTaskId = ref<string | null>(null)
const chatStreamMessageId = ref<string | null>(null)
const seenGatewayEvents = new Set<string>()
let chatAbortController: AbortController | undefined
const coreStatus = ref<CoreStatus | null>(null)
const coreError = ref('')
const coreActionRunning = ref('')
const coreManifestUrl = ref(DEFAULT_CORE_MANIFEST_URL)
const coreUpdateCheck = ref<CoreUpdateCheck | null>(null)
const coreUpdateError = ref('')
const packages = ref<readonly PackageInfo[]>([])
const packageError = ref('')
const copiedPackageId = ref('')
const preflight = ref<PreflightResult | null>(null)
const platformStatus = ref<PlatformStatus | null>(null)
const platformError = ref('')
const workerConfigResponse = ref<Awaited<ReturnType<typeof loadWorkerConfig>> | null>(null)
const workerConfig = ref<WorkerConfig | null>(null)
const workerConfigError = ref('')
const workerConfigMessage = ref('')
const workerConfigSaving = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

const iconUrl = `${import.meta.env.BASE_URL}icons/she.svg`
const tasks = computed(() => [...(snapshot.value?.tasks ?? [])].reverse())
const runningTasks = computed(() => tasks.value.filter(task => ['dispatching', 'submitted', 'running'].includes(task.status)).length)
const failedTasks = computed(() => tasks.value.filter(task => ['failed', 'needs_attention'].includes(task.status)).length)
const jobWarnings = computed(() => jobEvents.value.filter((event): event is Extract<JobEvent, { type: 'check' }> => event.type === 'check' && event.status === 'warn'))
const online = computed(() => health.value?.status === 'ok')
const brokerOnline = computed(() => brokerHealth.value?.status === 'ok')
const companionOnline = computed(() => companion.value !== null)
const companionOutdated = computed(() => companion.value !== null && isVersionOlder(companion.value.version, COMPANION_MIN_VERSION))

async function refresh(): Promise<void> {
  loading.value = true
  const [snapshotResult, sandboxResult, companionResult, coreStatusResult, packageResult, workerConfigResult, preflightResult, agentRuntimeResult, platformResult] = await Promise.allSettled([
    loadSnapshot(),
    loadSandboxes(),
    loadCompanionHealth(),
    loadCoreStatus(),
    loadPackages(),
    loadWorkerConfig(),
    loadPreflight(),
    loadAgentRuntime(),
    loadPlatformStatus(),
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
  if (preflightResult.status === 'fulfilled') preflight.value = preflightResult.value
  if (agentRuntimeResult.status === 'fulfilled') {
    agentRuntime.value = agentRuntimeResult.value
    agentRuntimeError.value = ''
  } else {
    agentRuntime.value = null
    agentRuntimeError.value = agentRuntimeResult.reason instanceof Error ? agentRuntimeResult.reason.message : String(agentRuntimeResult.reason)
  }
  if (platformResult.status === 'fulfilled') {
    platformStatus.value = platformResult.value
    platformError.value = ''
  } else {
    platformStatus.value = null
    platformError.value = platformResult.reason instanceof Error ? platformResult.reason.message : String(platformResult.reason)
  }
  if (workerConfigResult.status === 'fulfilled') {
    workerConfigResponse.value = workerConfigResult.value
    workerConfig.value = {
      ...workerConfigResult.value.config,
      model: workerConfigResult.value.config.model ?? { providerId: '', modelId: '' },
    }
    workerConfigError.value = ''
  } else {
    workerConfigError.value = workerConfigResult.reason instanceof Error ? workerConfigResult.reason.message : String(workerConfigResult.reason)
  }
  loading.value = false
}

async function saveWorker(restart: boolean): Promise<void> {
  if (workerConfig.value === null || workerConfigSaving.value) return
  workerConfigSaving.value = true
  workerConfigError.value = ''
  workerConfigMessage.value = ''
  try {
    const { model, ...rest } = workerConfig.value
    const payload: WorkerConfig = {
      ...rest,
      ...(model !== undefined && model.providerId.trim() !== '' && model.modelId.trim() !== ''
        ? { model: { providerId: model.providerId.trim(), modelId: model.modelId.trim(), ...(model.variant === undefined || model.variant.trim() === '' ? {} : { variant: model.variant.trim() }) } }
        : {}),
    }
    workerConfigResponse.value = await saveWorkerConfig(payload)
    workerConfig.value = workerConfigResponse.value.config
    if (restart && coreStatus.value?.installed.current !== null) {
      await runCoreAction('restart')
      workerConfigMessage.value = '已保存并重启 core；worker 会在新 core 启动时应用配置。'
    } else {
      workerConfigMessage.value = '已保存。需要重启 core 后生效。'
    }
    await refresh()
  } catch (cause) {
    workerConfigError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    workerConfigSaving.value = false
  }
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

async function installCore(): Promise<void> {
  if (jobRunning.value) return
  coreUpdateError.value = ''
  try {
    const check = await checkCoreUpdate(coreManifestUrl.value)
    coreUpdateCheck.value = check
    if (!check.needsUpdate) {
      coreUpdateError.value = check.current === null
        ? 'manifest 没有返回可安装的 Core 版本。'
        : `当前 Core 已是 ${check.current}，无需安装。`
      return
    }
    await applyCoreUpdate()
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
  if (event.type === 'check') return `[${event.status}] ${event.label}: ${event.detail}${event.remediation === undefined ? '' : `\n  → 修复：${event.remediation}`}`
  if (event.type === 'status') return `status: ${event.status}`
  return `done: ${event.status} (exit ${String(event.exitCode)})`
}

function packageStateClass(item: PackageInfo): string {
  if (['missing', 'unsupported', 'not-installed'].includes(item.state)) return 'failed'
  if (item.state.startsWith('ready') || item.state === 'installed') return 'succeeded'
  return 'warn'
}

function packageInstall(item: PackageInfo): PackageInstallInfo {
  return item.install ?? {
    mode: item.management,
    title: '安装/修复说明',
    commands: [],
    note: `当前本地 companion ${companion.value?.version ?? 'unknown'} 低于 PWA 期望的 ${COMPANION_MIN_VERSION}，因此 /api/packages 没有返回 install 字段。旧进程仍在运行；升级文件并不会自动替换它。`,
  }
}

async function copyPackageCommands(item: PackageInfo): Promise<void> {
  try {
    await navigator.clipboard.writeText(packageInstall(item).commands.join('\n'))
    copiedPackageId.value = item.id
    setTimeout(() => {
      if (copiedPackageId.value === item.id) copiedPackageId.value = ''
    }, 1500)
  } catch {
    copiedPackageId.value = ''
  }
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

function renderIntentText(intents: readonly RenderIntent[] | undefined): string {
  if (intents === undefined || intents.length === 0) return ''
  return intents.map(intent => {
    if (intent.kind === 'text') return intent.text
    if (intent.kind === 'progress') return intent.label ?? intent.stage
    if (intent.kind === 'status') return intent.label
    if (intent.kind === 'card') return intent.title ?? 'SHE card'
    if (intent.kind === 'approval') return intent.title
    if (intent.kind === 'form') return intent.title
    if (intent.kind === 'file') return `file: ${intent.artifact.fileName}`
    return ''
  }).filter(Boolean).join('\n')
}

function appendChat(role: ChatMessage['role'], text: string): string {
  const id = crypto.randomUUID()
  chatMessages.value.push({ id, role, text, at: Date.now() })
  return id
}

function appendChatDelta(text: string): void {
  if (text === '') return
  let id = chatStreamMessageId.value
  if (id === null) {
    id = appendChat('assistant', text)
    chatStreamMessageId.value = id
    return
  }
  const message = chatMessages.value.find(item => item.id === id)
  if (message === undefined) {
    chatStreamMessageId.value = appendChat('assistant', text)
    return
  }
  message.text += text
}

function handleGatewayEvent(event: GatewayServerEvent): void {
  if (event.type === 'render') {
    const key = `render:${event.render.renderId}:${String(event.render.sequence)}`
    if (seenGatewayEvents.has(key)) return
    seenGatewayEvents.add(key)
    const text = renderIntentText([event.render])
    if (text !== '') appendChatDelta(text)
    return
  }
  if (event.type !== 'task') return
  const taskEvent = event.event
  if (seenGatewayEvents.has(`event:${taskEvent.eventId}`)) return
  seenGatewayEvents.add(`event:${taskEvent.eventId}`)
  if (chatTaskId.value !== null && taskEvent.taskId !== chatTaskId.value) return
  if (taskEvent.type === 'agent.delta') {
    appendChatDelta(taskEvent.text)
    return
  }
  if (taskEvent.type === 'tool.call') {
    appendChat('system', `tool ${taskEvent.toolName}: ${taskEvent.status}`)
    return
  }
  if (taskEvent.type === 'task.completed') {
    chatStreamMessageId.value = null
    appendChat('system', '任务完成')
    chatTaskId.value = null
    return
  }
  if (taskEvent.type === 'task.failed') {
    chatStreamMessageId.value = null
    appendChat('system', `任务失败：${taskEvent.error.message}`)
    chatTaskId.value = null
  }
}

async function submitChat(): Promise<void> {
  const text = chatInput.value.trim()
  if (text === '' || chatSending.value) return
  chatSending.value = true
  chatError.value = ''
  chatInput.value = ''
  appendChat('user', text)
  chatStreamMessageId.value = null
  try {
    const result = await sendTaskToShe(text)
    if (result.taskId !== undefined) chatTaskId.value = result.taskId
    const rendered = renderIntentText(result.commandResult?.renderIntents)
    appendChat('assistant', rendered || (result.accepted ? 'Task accepted.' : 'Task was not accepted.'))
  } catch (cause) {
    chatError.value = cause instanceof Error ? cause.message : String(cause)
    appendChat('system', `发送失败：${chatError.value}`)
  } finally {
    chatSending.value = false
  }
}

async function chatEventLoop(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      for await (const event of subscribeGatewayEvents(signal)) handleGatewayEvent(event)
    } catch (cause) {
      if (signal.aborted) return
      chatError.value = cause instanceof Error ? cause.message : String(cause)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 2_000))
    }
  }
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 5000)
  chatAbortController = new AbortController()
  void chatEventLoop(chatAbortController.signal)
})
onBeforeUnmount(() => {
  if (timer !== undefined) clearInterval(timer)
  chatAbortController?.abort()
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
            <button v-if="companionOnline && coreStatus?.installed.current === null" class="primary" :disabled="jobRunning" @click="installCore">
              {{ jobRunning ? '安装中…' : '安装 Core' }}
            </button>
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

      <section v-else-if="active === 'agents'" class="agents-page">
        <div v-if="agentRuntimeError" class="alert">
          <strong>Agent 运行时状态不可用</strong>
          <p>{{ agentRuntimeError }}</p>
          <button class="primary" @click="active = 'setup'">打开 Install &amp; Doctor</button>
        </div>
        <div v-if="agentRuntime" class="grid">
          <article class="card wide">
            <div class="section-head">
              <div>
                <p class="eyebrow">AGENT RUNTIME</p>
                <h2>{{ agentRuntime.displayName }} · {{ agentRuntime.adapterId }}</h2>
                <p class="muted">只读状态来自 control plane，不在 PWA 维护第二状态源。</p>
              </div>
              <span :class="['pill', agentRuntime.health.ok ? 'succeeded' : 'failed']">
                {{ agentRuntime.health.ok ? 'healthy' : 'unavailable' }}
              </span>
            </div>
            <div class="health-grid">
              <div><span>configured</span><b>{{ agentRuntime.configured ? 'yes' : 'no' }}</b></div>
              <div><span>worker</span><b>{{ health?.worker?.state ?? 'unknown' }} · {{ health?.worker?.enabled ? 'enabled' : 'disabled' }}</b></div>
              <div><span>OpenCode URL</span><b>{{ agentRuntime.url }}</b></div>
              <div><span>username</span><b>{{ agentRuntime.username }}</b></div>
              <div><span>credential file</span><b><code>{{ agentRuntime.credentialFile }}</code>（仅路径，不读取内容）</b></div>
              <div><span>version</span><b>{{ agentRuntime.health.version ?? '-' }}</b></div>
              <div><span>checked</span><b>{{ relativeTime(agentRuntime.health.checkedAt) }}</b></div>
              <div><span>model</span><b>{{ agentRuntime.model ? `${agentRuntime.model.providerId} / ${agentRuntime.model.modelId}${agentRuntime.model.variant ? ` / ${agentRuntime.model.variant}` : ''}` : 'not configured' }}</b></div>
              <div v-if="agentRuntime.health.detail"><span>detail</span><b class="error-text">{{ agentRuntime.health.detail }}</b></div>
              <div v-if="health?.worker?.lastTaskId"><span>last task</span><b>{{ health.worker.lastTaskId }}</b></div>
              <div v-if="health?.worker?.lastError"><span>last error</span><b class="error-text">{{ health.worker.lastError }}</b></div>
            </div>
            <div v-if="!agentRuntime.configured || !agentRuntime.health.ok" class="alert">
              <strong>Agent runtime 尚未就绪</strong>
              <p>{{ agentRuntime.configured ? 'OpenCode 健康检查失败。请确认服务已启动，并检查 Settings 中的 URL 与凭据文件路径。' : 'Worker 未启用。请在 Settings 配置 OpenCode 和 worker，然后保存并重启 core。' }}</p>
              <button class="primary" @click="active = 'settings'">打开 Settings</button>
            </div>
          </article>

          <article class="card wide">
            <div class="section-head">
              <div>
                <h2>Workspace 授权（只读）</h2>
                <p class="muted">当前 worker 使用单一 workspace；只显示配置来源、真实路径和当前用户访问权限。</p>
              </div>
              <span :class="['pill', agentRuntime.workspace.leafAuthorized && agentRuntime.workspace.writable ? 'succeeded' : 'warn']">
                {{ agentRuntime.workspace.leafAuthorized ? (agentRuntime.workspace.writable ? 'read-write' : 'read-only') : 'needs attention' }}
              </span>
            </div>
            <div class="health-grid">
              <div><span>source</span><b>{{ agentRuntime.workspace.source }}</b></div>
              <div><span>path</span><b><code>{{ agentRuntime.workspace.path }}</code></b></div>
              <div><span>real path</span><b><code>{{ agentRuntime.workspace.realPath ?? '-' }}</code></b></div>
              <div><span>exists</span><b>{{ agentRuntime.workspace.exists ? 'yes' : 'no' }}</b></div>
              <div><span>directory</span><b>{{ agentRuntime.workspace.isDirectory ? 'yes' : 'no' }}</b></div>
              <div><span>read / write / execute</span><b>{{ agentRuntime.workspace.readable ? 'r' : '-' }}{{ agentRuntime.workspace.writable ? 'w' : '-' }}{{ agentRuntime.workspace.executable ? 'x' : '-' }}</b></div>
              <div><span>leaf authorized</span><b>{{ agentRuntime.workspace.leafAuthorized ? 'yes' : 'no' }}</b></div>
              <div><span>readOnly</span><b>{{ agentRuntime.workspace.readOnly ? 'yes' : 'no' }}</b></div>
            </div>
            <div v-for="warning in agentRuntime.workspace.warnings" :key="warning" class="warn-text">! {{ warning }}</div>
            <p class="muted small-note">
              这是只读视图，不会修改 workspace 权限。目录授权编辑与叶子目录白名单将在 T6.5 继续接入。
            </p>
          </article>
        </div>
      </section>

      <section v-else-if="active === 'workspaces'">
        <WorkspaceAuthorizationPanel />
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

      <section v-else-if="active === 'chat'" class="chat-page">
        <div class="card chat-card">
          <div class="section-head">
            <div>
              <h2>Agent Chat</h2>
              <p class="muted">
                conversation: <code>pwa:local</code> ·
                worker: {{ health?.worker?.state ?? 'unknown' }}
              </p>
            </div>
            <span :class="['pill', health?.worker?.state === 'running' ? 'running' : health?.worker?.state === 'idle' ? 'succeeded' : 'failed']">
              {{ health?.worker?.enabled ? health.worker.state : 'worker disabled' }}
            </span>
          </div>
          <div v-if="!health" class="alert">
            <strong>需要先启动 control plane</strong>
            <p>Chat 通过 control plane 提交任务并订阅 agent 事件。</p>
            <button class="primary" @click="active = 'setup'">打开 Install &amp; Doctor</button>
          </div>
          <div v-else-if="!health.worker?.enabled" class="alert">
            <strong>Worker 未启用</strong>
            <p>
              任务可以提交并排队，但不会执行。请用 OpenCode 配置启动 control plane worker：
              <code>SHE_WORKER_ENABLED=1</code>、<code>SHE_OPENCODE_URL</code>、<code>SHE_OPENCODE_PASSWORD_FILE</code>、
              <code>SHE_WORKSPACE_PATH</code>。
            </p>
          </div>
          <div class="chat-messages">
            <p v-if="chatMessages.length === 0" class="muted">
              在下方输入任务。SHE 会通过 <code>/she submit</code> 入队，并实时显示 agent text delta、工具状态和完成/失败事件。
            </p>
            <div v-for="message in chatMessages" :key="message.id" :class="['chat-message', message.role]">
              <span>{{ message.role }}</span>
              <p>{{ message.text }}</p>
            </div>
          </div>
          <p v-if="chatError" class="error-text">{{ chatError }}</p>
          <div class="chat-compose">
            <textarea v-model="chatInput" rows="4" placeholder="描述要交给 agent 的工作…" @keydown.ctrl.enter.prevent="submitChat"></textarea>
            <button class="primary" :disabled="chatSending || chatInput.trim() === ''" @click="submitChat">
              {{ chatSending ? 'Sending…' : '布置任务' }}
            </button>
          </div>
          <p class="muted small-note">Ctrl/Cmd + Enter 发送。agent 输出来自 task.agent_event → gateway event 流。</p>
        </div>
      </section>

      <section v-else-if="active === 'migrate'">
        <AgentMigrationPanel :broker-online="brokerOnline" />
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
              <code>bash install-companion.sh she-companion-${COMPANION_RELEASE_VERSION}.tar.gz --sha256 &lt;hash&gt;</code>
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
            <div v-if="companionOutdated" class="alert companion-outdated-alert">
              <strong>Companion 版本过低</strong>
              <p>
                当前 companion {{ companion.version }}，PWA 至少需要 {{ COMPANION_MIN_VERSION }}。
                请重新下载并运行一次 start.sh / start.command / start.bat；launcher 会把新版本安装到独立版本目录。
              </p>
              <p class="muted small-note">
                PWA 不会在运行中替换 companion。旧版本继续运行是正常的，但新的本地 API 和安装说明不会出现。
              </p>
            </div>
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
            </div>
            <details class="developer-tools">
              <summary>开发者工具（仅源码仓库使用）</summary>
              <p class="muted small-note">
                这些按钮执行 pnpm 脚本，只用于 SHE 源码开发/调试。正常安装用户不需要点击；
                安装版 companion 不包含完整源码目录。
              </p>
              <div class="job-actions">
                <button class="secondary" :disabled="jobRunning" @click="runJob('install')">安装源码依赖</button>
                <button class="secondary" :disabled="jobRunning" @click="runJob('build')">构建 PWA 前端</button>
                <button class="secondary" :disabled="jobRunning" @click="runJob('build-all')">构建 TypeScript 包</button>
                <button class="secondary" :disabled="jobRunning" @click="runJob('test')">运行测试</button>
              </div>
            </details>
            <p v-if="jobError" class="error-text">{{ jobError }}</p>
            <p v-if="job" class="muted">last job: {{ job.kind }} · {{ job.status }} · {{ job.id }}</p>
            <p v-if="jobWarnings.length > 0" class="warn-text">
              任务已完成，但有 {{ jobWarnings.length }} 个环境能力 warning；job 成功只代表该动作执行成功，不代表 Docker 等可选能力已就绪。
            </p>
          </div>

          <div class="card wide-card environment-card">
            <div class="section-head">
              <div>
                <h2>环境能力摘要</h2>
                <p class="muted">基础工具链与容器能力分开判断；Docker 缺失不会阻止 companion/core 启动，但会使 Sandbox、Agent Migration 和 broker 容器不可用。</p>
              </div>
              <span v-if="preflight?.at" :class="['pill', preflight.ok ? (preflight.sandboxReady ? 'succeeded' : 'warn') : 'failed']">
                {{ preflight.ok ? (preflight.sandboxReady ? 'full' : 'partial') : 'blocked' }}
              </span>
              <span v-else class="pill">not checked</span>
            </div>
            <div v-if="!preflight?.at" class="alert">
              <strong>还没有环境检查结果</strong>
              <p>点击上方“环境检查”获取 Node/pnpm/Docker/socket 的逐项能力判断。</p>
            </div>
            <template v-else>
              <div class="health-grid">
                <div><span>基础工具链</span><b>{{ preflight.ok ? 'ready' : 'blocked' }}</b></div>
                <div><span>Sandbox / Docker</span><b>{{ preflight.sandboxReady ? 'ready' : 'unavailable' }}</b></div>
                <div><span>warnings</span><b>{{ preflight.summary?.warnings ?? preflight.warnings?.length ?? 0 }}</b></div>
                <div><span>failures</span><b>{{ preflight.summary?.failures ?? 0 }}</b></div>
              </div>
              <div v-if="preflight.sandboxReady === false" class="alert environment-warning">
                <strong>未检测到可用的 Docker sandbox runtime</strong>
                <p>
                  这不影响 companion、core、Tasks 和普通 Chat；但 Sandboxes、Agent Migration 以及 broker 容器能力暂时不可用。
                  用户级环境准备只安装 pnpm，不会安装 Docker，也不会执行 sudo。
                </p>
                <p v-for="warning in (preflight.warnings ?? []).filter(item => item.feature === 'sandbox')" :key="warning.label">
                  {{ warning.detail }}<br />
                  <span v-if="warning.remediation">修复：{{ warning.remediation }}</span>
                </p>
                <a class="secondary" href="https://docs.docker.com/engine/install/" target="_blank" rel="noreferrer">Docker 官方安装文档 ↗</a>
              </div>
              <details v-if="(preflight.warnings?.length ?? 0) > 0" class="preflight-details">
                <summary>查看全部 {{ preflight.warnings?.length }} 个 warning</summary>
                <ul>
                  <li v-for="warning in preflight.warnings" :key="warning.label">
                    <b>{{ warning.label }}</b>：{{ warning.detail }}
                    <span v-if="warning.remediation"><br />修复：{{ warning.remediation }}</span>
                  </li>
                </ul>
              </details>
            </template>
          </div>

          <div class="card wide-card platform-card">
            <div class="section-head">
              <div>
                <h2>平台能力与支持矩阵</h2>
                <p class="muted">明确当前平台、Docker 模式和已验证/未验证能力，不把未验收平台伪装成 production-ready。</p>
              </div>
              <span v-if="platformStatus" class="pill">{{ platformStatus.runtime.platform }} / {{ platformStatus.runtime.arch }}</span>
              <span v-else class="pill">unavailable</span>
            </div>
            <p v-if="platformError" class="error-text">{{ platformError }}（旧 companion 可能未提供 `/api/platform`，升级 companion 后会显示。）</p>
            <template v-if="platformStatus">
              <div class="health-grid">
                <div><span>Node</span><b>{{ platformStatus.runtime.node }}</b></div>
                <div><span>shell</span><b>{{ platformStatus.runtime.shell }}</b></div>
                <div><span>uid</span><b>{{ platformStatus.runtime.uid ?? 'n/a' }}</b></div>
                <div><span>WSL</span><b>{{ platformStatus.runtime.wsl ? 'yes' : 'no' }}</b></div>
                <div><span>Docker</span><b>{{ platformStatus.docker.available ? platformStatus.docker.mode : 'unavailable' }}{{ platformStatus.docker.version ? ` · ${platformStatus.docker.version}` : '' }}</b></div>
                <div><span>unix socket</span><b>{{ platformStatus.capabilities.unixSocket ? 'supported' : 'not supported' }}</b></div>
              </div>
              <div class="support-table-wrap">
                <table class="support-table">
                  <thead><tr><th>能力</th><th>Linux</th><th>macOS</th><th>Windows</th></tr></thead>
                  <tbody>
                    <tr v-for="row in platformStatus.supportMatrix" :key="row.feature">
                      <td>{{ row.feature }}</td>
                      <td><span :class="['pill', row.linux === 'verified' ? 'succeeded' : row.linux === 'unsupported' ? 'failed' : 'warn']">{{ row.linux }}</span></td>
                      <td><span :class="['pill', row.macos === 'verified' ? 'succeeded' : row.macos === 'unsupported' ? 'failed' : 'warn']">{{ row.macos }}</span></td>
                      <td><span :class="['pill', row.windows === 'verified' ? 'succeeded' : row.windows === 'unsupported' ? 'failed' : 'warn']">{{ row.windows }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <ul class="platform-notes">
                <li v-for="note in platformStatus.notes" :key="note">{{ note }}</li>
              </ul>
              <p class="muted small-note">
                支持矩阵与平台探测文档：<a href="https://github.com/pancong0711/she/blob/main/docs/PLATFORM-SUPPORT.md" target="_blank" rel="noreferrer">docs/PLATFORM-SUPPORT.md ↗</a>
              </p>
            </template>
          </div>

          <div class="card core-card">
            <p class="eyebrow">CORE RUNTIME</p>
            <h2>Core 安装、版本与更新</h2>
            <p v-if="coreError" class="error-text">{{ coreError }}</p>
            <div v-if="coreStatus && coreStatus.installed.current === null" class="alert core-install-alert">
              <strong>Core 尚未安装</strong>
              <p>Companion 只是本地宿主。Tasks、Chat、control-plane 和 broker 需要 Core bundle；首次使用请先安装 Core。</p>
              <button class="primary" :disabled="jobRunning" @click="installCore">{{ jobRunning ? '安装中…' : '安装 Core' }}</button>
            </div>
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
              <button v-if="coreStatus?.installed.current === null" class="primary" :disabled="jobRunning" @click="installCore">{{ jobRunning ? '安装中…' : '安装 Core' }}</button>
              <button class="secondary" :disabled="coreActionRunning !== '' || coreStatus?.installed.current === null" @click="runCoreAction('start')">{{ coreActionRunning === 'start' ? 'Starting…' : '启动 core' }}</button>
              <button class="secondary" :disabled="coreActionRunning !== '' || coreStatus?.installed.current === null" @click="runCoreAction('stop')">{{ coreActionRunning === 'stop' ? 'Stopping…' : '停止 core' }}</button>
              <button class="secondary" :disabled="coreActionRunning !== '' || coreStatus?.installed.current === null" @click="runCoreAction('restart')">{{ coreActionRunning === 'restart' ? 'Restarting…' : '重启 core' }}</button>
            </div>
            <label for="core-manifest">Core Release manifest URL</label>
            <div class="connect-row">
              <input id="core-manifest" v-model="coreManifestUrl" placeholder="https://…/release-manifest.json" />
              <button class="secondary" :disabled="jobRunning" @click="runCoreUpdateCheck">检查版本</button>
            </div>
            <p v-if="coreUpdateError" class="error-text">{{ coreUpdateError }}</p>
            <div v-if="coreUpdateCheck" class="update-check">
              <p>当前：<b>{{ coreUpdateCheck.current ?? '未安装' }}</b> · 可用：<b>{{ coreUpdateCheck.available ?? 'unknown' }}</b></p>
              <p v-if="!coreUpdateCheck.needsUpdate" class="muted">已是最新版本。</p>
              <button v-else class="primary" :disabled="jobRunning" @click="applyCoreUpdate">{{ coreUpdateCheck.current === null ? '安装 Core' : '更新 Core' }}</button>
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
              <span :class="['pill', jobRunning ? 'running' : jobWarnings.length > 0 ? 'warn' : job?.status ?? 'stopped']">
                {{ jobRunning ? `${jobKind} running` : jobWarnings.length > 0 ? `${job?.status ?? 'done'} · ${jobWarnings.length} warnings` : job?.status ?? 'idle' }}
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
        <div v-if="companionOutdated" class="alert companion-outdated-alert">
          <strong>Packages 数据来自旧 companion，安装方法不可用</strong>
          <p>
            当前本地 companion：<b>{{ companion?.version ?? 'unknown' }}</b>，
            PWA 期望至少：<b>{{ COMPANION_MIN_VERSION }}</b>。
            Docker/Node 等卡片的安装命令需要新版 companion 的 <code>/api/packages</code> 返回 <code>install</code> 字段。
          </p>
          <p>
            仅安装新 bundle 不会替换正在运行的旧进程。请先停止旧 companion，再重新运行新版 <code>start.sh</code>，
            然后回到本页点击 Refresh。
          </p>
          <div class="package-actions">
            <a class="primary" href="./start.sh" download>下载新版 start.sh</a>
            <button class="secondary" :disabled="loading" @click="refresh">重新连接并刷新</button>
          </div>
        </div>
        <div v-if="packageError" class="alert">
          <strong>Package catalog 不可用</strong>
          <p>{{ packageError }}</p>
        </div>
        <div class="card">
          <div class="section-head">
            <div>
              <h2>软件包、运行时与依赖</h2>
              <p class="muted">
                依赖分为 SHE 托管组件、基础运行时、sandbox/agent 运行时。除已白名单化的 pnpm/core 操作外，
                下方命令只展示安装方法，由你本人确认后执行；SHE 不执行 sudo，不请求 root。
              </p>
            </div>
            <button class="secondary" :disabled="loading" @click="refresh">Refresh</button>
          </div>
          <div class="package-grid">
            <article v-for="item in packages" :key="item.id" :class="['package-card', { 'package-missing': ['missing', 'unsupported', 'not-installed'].includes(item.state) }]">
              <div class="sandbox-head">
                <div>
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.kind }} · {{ item.requirement }} · {{ item.management }}</small>
                </div>
                <span :class="['pill', packageStateClass(item)]">{{ item.state }}</span>
              </div>
              <div class="sandbox-meta">
                <span>installed <b>{{ item.installedVersion ?? 'not detected' }}</b></span>
                <span v-if="item.previousVersion">previous <b>{{ item.previousVersion }}</b></span>
              </div>
              <p class="muted small-note">用于：{{ (item.requiredFor ?? []).join(' · ') || '—' }}</p>
              <p class="muted small-note">{{ item.note }}</p>
              <div class="package-install">
                <div class="package-install-head">
                  <strong>{{ packageInstall(item).title }}</strong>
                  <span class="pill">{{ packageInstall(item).mode }}</span>
                </div>
                <p class="muted small-note">{{ packageInstall(item).note }}</p>
                <pre v-if="packageInstall(item).commands.length > 0" class="package-commands"><code>{{ packageInstall(item).commands.join('\n') }}</code></pre>
                <div class="package-actions">
                  <button v-if="packageInstall(item).commands.length > 0" class="secondary" @click="copyPackageCommands(item)">
                    {{ copiedPackageId === item.id ? '已复制' : '复制安装命令' }}
                  </button>
                  <a v-if="packageInstall(item).url" class="secondary" :href="packageInstall(item).url" target="_blank" rel="noreferrer">官方文档 ↗</a>
                  <template v-if="item.management === 'launcher'">
                    <a class="secondary" href="./start.bat" download>Windows launcher</a>
                    <a class="secondary" href="./start.command" download>macOS launcher</a>
                    <a class="secondary" href="./start.sh" download>Linux launcher</a>
                  </template>
                  <button v-else-if="item.management === 'core-update' && coreStatus?.installed.current === null" class="primary" :disabled="jobRunning" @click="installCore">{{ jobRunning ? '安装中…' : '安装 Core' }}</button>
                  <button v-else-if="item.management === 'core-update'" class="primary" @click="active = 'setup'">打开 Core 更新</button>
                  <button v-else-if="item.management === 'bootstrap'" class="primary" :disabled="jobRunning" @click="runJob('bootstrap')">用户级准备 pnpm</button>
                </div>
                <p v-if="item.management === 'instructions-only'" class="muted small-note package-manual-note">
                  系统/运行时安装由你本人执行；SHE 只做检测和说明，不调用 sudo。
                </p>
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

        <div class="worker-settings">
          <h2>Agent Worker / OpenCode</h2>
          <p class="muted">
            worker 通过 control plane 执行 `/she submit` 任务。这里只保存 OpenCode 凭据文件路径，
            不保存密码内容；需要重启 core 后生效。
          </p>
          <p v-if="workerConfigError" class="error-text">{{ workerConfigError }}</p>
          <p v-if="workerConfigMessage" class="success-text">{{ workerConfigMessage }}</p>
          <div v-if="workerConfig" class="settings-grid">
            <label class="check-row"><input v-model="workerConfig.enabled" type="checkbox" /> 启用 worker</label>
            <label>OpenCode URL<input v-model="workerConfig.opencodeUrl" placeholder="http://127.0.0.1:49375" /></label>
            <label>OpenCode username<input v-model="workerConfig.opencodeUsername" /></label>
            <label>Password file（只保存路径）<input v-model="workerConfig.opencodePasswordFile" placeholder="/home/user/.config/opencode/service.json" /></label>
            <label>Workspace path<input v-model="workerConfig.workspacePath" placeholder="/home/user/projects/my-workspace" /></label>
            <label>Model provider<input v-model="workerConfig.model!.providerId" placeholder="opencode-go" /></label>
            <label>Model ID<input v-model="workerConfig.model!.modelId" placeholder="deepseek-v4.1-flash" /></label>
            <label>Model variant<input v-model="workerConfig.model!.variant" placeholder="high（可选）" /></label>
            <label>Poll interval (ms)<input v-model.number="workerConfig.pollIntervalMs" type="number" min="100" /></label>
            <label>Lease TTL (ms)<input v-model.number="workerConfig.leaseTtlMs" type="number" min="1000" /></label>
          </div>
          <p v-if="workerConfigResponse?.path" class="muted small-note">config file: {{ workerConfigResponse.path }}</p>
          <div class="job-actions">
            <button class="secondary" :disabled="workerConfigSaving || workerConfig === null" @click="saveWorker(false)">保存</button>
            <button class="primary" :disabled="workerConfigSaving || workerConfig === null || coreStatus?.installed.current === null" @click="saveWorker(true)">保存并重启 core</button>
          </div>
        </div>
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
