<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  applyAgentMigration,
  loadAgentDiscovery,
  loadAgentMigrations,
  loadSandboxPreferences,
  loadWorkspaces,
  planAgentMigration,
  streamJobEvents,
  type AgentDiscovery,
  type AgentDiscoveryPlanResult,
  type AgentMigrationRecord,
  type DiscoveredAgentService,
  type JobEvent,
  type JobSummary,
  type MigrationAgentInput,
  type MigrationRequest,
  type SandboxPreferences,
  type WorkspaceAuthorization,
} from '../api'

defineProps<{ brokerOnline: boolean }>()

interface AgentSettings {
  sourceWorkspacePath: string
  workspaceAuthorizationId: string
  workspaceMode: 'new' | 'reuse'
  newWorkspacePath: string
  legacyReadOnly: boolean
  credentialPaths: string[]
}

const discovery = ref<AgentDiscovery | null>(null)
const loading = ref(false)
const error = ref('')
const selected = ref<Record<string, boolean>>({})
const settings = ref<Record<string, AgentSettings>>({})
const image = ref('node:22-bookworm-slim')
const commandText = ref('sleep infinity')
const networkMode = ref<'none' | 'egress'>('egress')
const cpus = ref(1)
const memoryMb = ref(1024)
const pids = ref(256)
const planResult = ref<AgentDiscoveryPlanResult | null>(null)
const planError = ref('')
const planning = ref(false)
const applying = ref(false)
const job = ref<JobSummary | null>(null)
const jobEvents = ref<JobEvent[]>([])
const records = ref<readonly AgentMigrationRecord[]>([])
const recordsError = ref('')
const workspaces = ref<readonly WorkspaceAuthorization[]>([])
const workspaceError = ref('')
const sandboxPreferences = ref<SandboxPreferences | null>(null)

const selectedServices = computed(() => (discovery.value?.services ?? []).filter(service => selected.value[service.id] === true))
const diagnostics = computed(() => jobEvents.value.filter((event): event is Extract<JobEvent, { type: 'log' | 'system' }> => event.type === 'log' || event.type === 'system'))
const canApply = computed(() => planResult.value !== null && !planResult.value.plan.blocked && selectedServices.value.length > 0 && !applying.value)

function settingsFor(service: DiscoveredAgentService): AgentSettings {
  const existing = settings.value[service.id]
  if (existing !== undefined) return existing
  const defaults: AgentSettings = {
    sourceWorkspacePath: service.cwd ?? '',
    workspaceAuthorizationId: '',
    workspaceMode: 'new',
    newWorkspacePath: '',
    legacyReadOnly: service.cwd !== undefined,
    credentialPaths: [],
  }
  settings.value = { ...settings.value, [service.id]: defaults }
  return defaults
}

function availableWorkspaces(service: DiscoveredAgentService): readonly WorkspaceAuthorization[] {
  const config = settingsFor(service)
  return workspaces.value.filter(item => config.workspaceMode === 'reuse' ? item.mode === 'read-write' : true)
}

function setWorkspaceMode(service: DiscoveredAgentService, mode: 'new' | 'reuse'): void {
  const config = settingsFor(service)
  config.workspaceMode = mode
  const selectedWorkspace = workspaces.value.find(item => item.id === config.workspaceAuthorizationId)
  if (mode === 'reuse' && selectedWorkspace !== undefined && selectedWorkspace.mode !== 'read-write') {
    config.workspaceAuthorizationId = ''
    config.sourceWorkspacePath = ''
  }
}

function selectWorkspace(service: DiscoveredAgentService, id: string): void {
  const config = settingsFor(service)
  config.workspaceAuthorizationId = id
  const workspace = workspaces.value.find(item => item.id === id)
  if (workspace === undefined) return
  config.sourceWorkspacePath = workspace.path
  if (config.workspaceMode === 'reuse' && workspace.mode === 'read-only') {
    config.workspaceMode = 'new'
    config.legacyReadOnly = true
  }
}

async function loadSandboxDefaults(): Promise<void> {
  try {
    sandboxPreferences.value = (await loadSandboxPreferences()).config
    image.value = sandboxPreferences.value.defaultImage
    networkMode.value = sandboxPreferences.value.networkMode
    cpus.value = sandboxPreferences.value.resources.cpus
    memoryMb.value = sandboxPreferences.value.resources.memoryMb
    pids.value = sandboxPreferences.value.resources.pids
  } catch {
    sandboxPreferences.value = null
  }
}

async function loadWorkspaceOptions(): Promise<void> {
  workspaceError.value = ''
  try {
    workspaces.value = (await loadWorkspaces()).workspaces
  } catch (cause) {
    workspaces.value = []
    workspaceError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function credentialSuggestions(service: DiscoveredAgentService) {
  return (discovery.value?.credentialSuggestions ?? []).filter(item => item.agentKind === service.kind)
}

function toggleCredential(service: DiscoveredAgentService, path: string): void {
  const config = settingsFor(service)
  config.credentialPaths = config.credentialPaths.includes(path)
    ? config.credentialPaths.filter(value => value !== path)
    : [...config.credentialPaths, path]
}

async function scan(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  planResult.value = null
  planError.value = ''
  try {
    discovery.value = await loadAgentDiscovery()
    for (const service of discovery.value.services) settingsFor(service)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

function requestPayload(): MigrationRequest {
  const agents: MigrationAgentInput[] = selectedServices.value.map(service => {
    const config = settingsFor(service)
    return {
      id: service.id,
      sourceWorkspacePath: config.sourceWorkspacePath.trim(),
      ...(config.workspaceAuthorizationId === '' ? {} : { sourceWorkspaceAuthorizationId: config.workspaceAuthorizationId }),
      workspaceMode: config.workspaceMode,
      ...(config.workspaceMode === 'new' && config.newWorkspacePath.trim() !== '' ? { newWorkspacePath: config.newWorkspacePath.trim() } : {}),
      legacyReadOnly: config.workspaceMode === 'new' && config.legacyReadOnly,
      credentialPaths: config.credentialPaths,
    }
  })
  return {
    agents,
    image: image.value.trim(),
    command: commandText.value.trim().split(/\s+/).filter(Boolean),
    networkMode: networkMode.value,
    resources: { cpus: cpus.value, memoryMb: memoryMb.value, pids: pids.value },
  }
}

async function previewPlan(): Promise<void> {
  if (planning.value) return
  planning.value = true
  planError.value = ''
  planResult.value = null
  try {
    planResult.value = await planAgentMigration(requestPayload())
  } catch (cause) {
    planError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    planning.value = false
  }
}

async function apply(): Promise<void> {
  if (!canApply.value) return
  applying.value = true
  planError.value = ''
  job.value = null
  jobEvents.value = []
  try {
    job.value = await applyAgentMigration(requestPayload())
    for await (const event of streamJobEvents(job.value.id)) jobEvents.value = [...jobEvents.value, event]
    await loadRecords()
    await scan()
  } catch (cause) {
    planError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    applying.value = false
  }
}

async function loadRecords(): Promise<void> {
  recordsError.value = ''
  try {
    records.value = await loadAgentMigrations()
  } catch (cause) {
    recordsError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

watch([selected, settings, image, commandText, networkMode, cpus, memoryMb, pids], () => {
  if (planning.value || applying.value) return
  planResult.value = null
  planError.value = ''
}, { deep: true })

onMounted(async () => {
  await Promise.all([scan(), loadRecords(), loadWorkspaceOptions(), loadSandboxDefaults()])
})
</script>

<template>
  <section class="migration-page">
    <div class="card migration-intro">
      <div class="section-head">
        <div>
          <p class="eyebrow">LOCAL AGENT MIGRATION</p>
          <h2>发现本机 AI agent，并安全地迁移到 sandbox</h2>
          <p class="muted">
            SHE 只读取进程元数据、cwd、监听端口和已知配置目录是否存在；
            不读取凭据内容、不停止原进程、不执行 sudo。凭据目录由用户勾选后以只读 bind mount 交给容器。
          </p>
        </div>
        <button class="primary" :disabled="loading" @click="scan">
          {{ loading ? '扫描中…' : '重新扫描本机' }}
        </button>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div v-if="discovery" class="discovery-meta">
        <span class="pill">platform {{ discovery.platform }}</span>
        <span class="pill">home {{ discovery.home }}</span>
        <span :class="['pill', discovery.docker.available ? 'succeeded' : 'failed']">
          docker {{ discovery.docker.available ? 'available' : 'unavailable' }}
        </span>
        <span class="muted small-note">last scan {{ new Date(discovery.scannedAt).toLocaleString() }}</span>
      </div>
      <p v-if="discovery && !discovery.docker.available" class="alert">
        docker 当前不可用。扫描和计划仍可预览，但“执行迁移”会失败；请先由你本人配置 Docker/rootless runtime。
      </p>
    </div>

    <div v-if="discovery" class="card">
      <div class="section-head">
        <div>
          <h2>检测到的服务</h2>
          <p class="muted">勾选要迁移的条目；未运行的配置条目需手动确认工作目录。</p>
        </div>
        <span class="pill">{{ discovery.services.length }} candidates</span>
      </div>
      <p v-if="discovery.services.length === 0" class="muted">未发现已知 AI agent 进程或配置目录。</p>
      <div class="agent-list">
        <article v-for="service in discovery.services" :key="service.id" :class="['agent-card', { selected: selected[service.id] }]">
          <label class="agent-select">
            <input v-model="selected[service.id]" type="checkbox" />
            <span>
              <strong>{{ service.name }}</strong>
              <small>{{ service.kind }} · {{ service.id }}</small>
            </span>
          </label>
          <div class="agent-badges">
            <span :class="['pill', service.running ? 'running' : 'stopped']">{{ service.running ? 'running' : 'installed only' }}</span>
            <span v-if="service.pid" class="pill">pid {{ service.pid }}</span>
            <span v-for="port in service.ports" :key="port" class="pill">:{{ port }}</span>
            <span :class="['pill', service.containerizable ? 'succeeded' : 'warn']">
              {{ service.containerizable ? 'workspace detected' : 'manual path needed' }}
            </span>
          </div>
          <p v-if="service.command" class="command-line"><code>{{ service.command }}</code></p>
          <p v-if="service.cwd" class="muted small-note">cwd: <code>{{ service.cwd }}</code></p>
          <p v-for="warning in service.warnings" :key="warning" class="warn-text">{{ warning }}</p>

          <div v-if="selected[service.id]" class="agent-settings">
            <div class="mode-row">
              <label class="check-row"><input :checked="settingsFor(service).workspaceMode === 'new'" type="radio" value="new" @change="setWorkspaceMode(service, 'new')" /> 新建工作空间</label>
              <label class="check-row"><input :checked="settingsFor(service).workspaceMode === 'reuse'" type="radio" value="reuse" @change="setWorkspaceMode(service, 'reuse')" /> 复用已授权目录（读写挂载）</label>
            </div>
            <label v-if="settingsFor(service).workspaceMode === 'reuse' || settingsFor(service).legacyReadOnly">
              已授权 workspace
              <select v-model="settingsFor(service).workspaceAuthorizationId" @change="selectWorkspace(service, settingsFor(service).workspaceAuthorizationId)">
                <option value="">请选择（需先加入 Workspaces 授权）</option>
                <option v-for="workspace in availableWorkspaces(service)" :key="workspace.id" :value="workspace.id">
                  {{ workspace.label }} · {{ workspace.mode }} · {{ workspace.path }}
                </option>
              </select>
            </label>
            <p v-if="settingsFor(service).workspaceAuthorizationId" class="muted small-note">
              source: <code>{{ settingsFor(service).sourceWorkspacePath }}</code>
            </p>
            <p v-if="settingsFor(service).workspaceMode === 'reuse' || settingsFor(service).legacyReadOnly" class="muted small-note">
              只读授权只能用于新建 workspace 的 /legacy 只读挂载；复用为读写 workspace 必须选择 read-write 授权。
            </p>
            <p v-if="workspaceError" class="error-text">{{ workspaceError }}</p>
            <p v-if="workspaces.length === 0 && (settingsFor(service).workspaceMode === 'reuse' || settingsFor(service).legacyReadOnly)" class="warn-text">
              还没有 workspace 授权。请先到 Workspaces 页面授权叶子目录。
            </p>
            <label v-if="settingsFor(service).workspaceMode === 'new'">
              新工作空间路径（留空自动创建）
              <input v-model="settingsFor(service).newWorkspacePath" placeholder="留空 = ~/.local/share/she/workspaces/..." />
            </label>
            <label v-if="settingsFor(service).workspaceMode === 'new'" class="check-row">
              <input v-model="settingsFor(service).legacyReadOnly" type="checkbox" />
              将原目录只读挂载到 /legacy
            </label>
            <div v-if="credentialSuggestions(service).length > 0" class="credential-list">
              <p class="muted small-note">凭据目录（只读挂载，不读取内容）</p>
              <label v-for="suggestion in credentialSuggestions(service)" :key="suggestion.path" class="check-row">
                <input
                  type="checkbox"
                  :checked="settingsFor(service).credentialPaths.includes(suggestion.path)"
                  @change="toggleCredential(service, suggestion.path)"
                />
                {{ suggestion.label }} · <code>{{ suggestion.path }}</code>
              </label>
            </div>
          </div>
        </article>
      </div>
    </div>

    <div v-if="discovery" class="card">
      <h2>容器设置</h2>
      <p v-if="sandboxPreferences" class="muted small-note">默认值来自 Packages → Sandbox 镜像与默认资源；可在此覆盖。</p>
      <div class="settings-grid migration-grid">
        <label>镜像<input v-model="image" placeholder="node:22-bookworm-slim" /></label>
        <label>容器启动命令<input v-model="commandText" placeholder="sleep infinity" /></label>
        <label>
          网络
          <select v-model="networkMode">
            <option value="egress">egress（访问模型/API）</option>
            <option value="none">none（离线）</option>
          </select>
        </label>
        <label>CPUs<input v-model.number="cpus" type="number" min="0.1" max="64" step="0.1" /></label>
        <label>Memory MB<input v-model.number="memoryMb" type="number" min="128" max="131072" /></label>
        <label>PIDs<input v-model.number="pids" type="number" min="16" max="16384" /></label>
      </div>
      <p class="muted small-note">
        镜像需要包含对应 agent runtime；SHE 不自动猜测安装包。根目录、用户主目录本身、受保护系统目录不能作为工作空间或旧目录挂载。
      </p>
      <div class="job-actions">
        <button class="secondary" :disabled="planning || selectedServices.length === 0" @click="previewPlan">
          {{ planning ? '校验中…' : '生成迁移计划' }}
        </button>
        <button class="primary" :disabled="!canApply || !brokerOnline" @click="apply">
          {{ applying ? '执行中…' : '执行一键迁移' }}
        </button>
      </div>
      <p v-if="!brokerOnline" class="warn-text">broker 离线，无法创建 sandbox。请先在 Install &amp; Doctor 或运行环境中启动 broker。</p>
      <p v-if="planError" class="error-text">{{ planError }}</p>
    </div>

    <div v-if="planResult" class="card plan-card">
      <div class="section-head">
        <div>
          <h2>迁移计划</h2>
          <p class="muted">{{ planResult.plan.agents.length }} 个 sandbox · {{ planResult.plan.blocked ? '存在阻断项' : '校验通过' }}</p>
        </div>
        <span :class="['pill', planResult.plan.blocked ? 'failed' : 'succeeded']">{{ planResult.plan.blocked ? 'blocked' : 'ready' }}</span>
      </div>
      <div v-for="errorItem in planResult.plan.errors" :key="errorItem.message" class="error-text">✕ {{ errorItem.message }}</div>
      <div v-for="warning in planResult.plan.warnings" :key="warning.message" class="warn-text">! {{ warning.message }}</div>
      <div class="plan-agents">
        <div v-for="agent in planResult.plan.agents" :key="agent.candidateId" class="plan-agent">
          <strong>{{ agent.name }}</strong>
          <span class="pill">{{ agent.sandboxName }}</span>
          <span class="pill">{{ agent.workspaceMode === 'reuse' ? '旧目录读写挂载' : '新工作空间' }}</span>
          <span v-if="agent.legacyReadOnly" class="pill">/legacy 只读</span>
          <span v-if="agent.credentialMounts.length > 0" class="pill">{{ agent.credentialMounts.length }} 个凭据目录只读</span>
          <p class="muted small-note">workspace: <code>{{ agent.newWorkspacePath ?? agent.sourceWorkspacePath }}</code></p>
        </div>
      </div>
      <ol class="plan-steps">
        <li v-for="step in planResult.plan.steps" :key="step">{{ step }}</li>
      </ol>
    </div>

    <div v-if="job" class="card">
      <div class="section-head">
        <h2>迁移任务</h2>
        <span :class="['pill', job.status === 'succeeded' ? 'succeeded' : job.status === 'failed' ? 'failed' : 'running']">{{ job.status }}</span>
      </div>
      <pre class="job-log">{{ diagnostics.map(event => `${new Date(event.at).toLocaleTimeString()} ${event.type === 'log' ? `[${event.stream}] ` : ''}${event.text}`).join('\n') }}</pre>
    </div>

    <div class="card">
      <div class="section-head">
        <div>
          <h2>迁移记录</h2>
          <p class="muted">记录只保存路径和 sandbox 标识，不保存凭据内容。</p>
        </div>
        <button class="secondary" @click="loadRecords">刷新</button>
      </div>
      <p v-if="recordsError" class="error-text">{{ recordsError }}</p>
      <p v-if="records.length === 0" class="muted">还没有迁移记录。</p>
      <div v-for="record in records" :key="record.id" class="migration-record">
        <div>
          <strong>{{ record.id }}</strong>
          <span :class="['pill', record.status === 'succeeded' ? 'succeeded' : 'failed']">{{ record.status }}</span>
          <span class="muted small-note">{{ new Date(record.createdAt).toLocaleString() }}</span>
        </div>
        <p v-for="agent in record.agents" :key="agent.sandboxName" class="muted small-note">
          {{ agent.name }} → <code>{{ agent.sandboxName }}</code> · {{ agent.workspaceMode === 'new' ? 'new workspace' : 'reuse' }}
          · {{ agent.credentialMounts.length }} credential mount(s)
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.migration-intro { margin-bottom: 1rem; }
.discovery-meta { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: .75rem; }
.agent-list { display: grid; gap: .75rem; }
.agent-card { border: 1px solid rgba(148, 163, 184, .25); border-radius: 12px; padding: .9rem; background: rgba(15, 23, 42, .35); }
.agent-card.selected { border-color: #38bdf8; box-shadow: 0 0 0 1px rgba(56, 189, 248, .25); }
.agent-select { display: flex; gap: .6rem; align-items: flex-start; cursor: pointer; }
.agent-select strong { display: block; }
.agent-select small { color: #94a3b8; }
.agent-badges { display: flex; flex-wrap: wrap; gap: .4rem; margin: .55rem 0; }
.command-line { margin: .4rem 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.command-line code { font-size: .78rem; color: #cbd5e1; }
.agent-settings { display: grid; gap: .65rem; margin-top: .75rem; padding-top: .75rem; border-top: 1px dashed rgba(148, 163, 184, .25); }
.agent-settings label { display: grid; gap: .3rem; }
.agent-settings input[type="text"], .agent-settings input:not([type]) { width: 100%; }
.mode-row { display: flex; flex-wrap: wrap; gap: 1rem; }
.check-row { display: flex !important; flex-direction: row; gap: .45rem; align-items: center; }
.credential-list { display: grid; gap: .35rem; padding: .55rem; border-radius: 8px; background: rgba(2, 6, 23, .35); }
.migration-grid { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
.plan-card { margin-top: 1rem; }
.plan-agents { display: grid; gap: .5rem; margin: .75rem 0; }
.plan-agent { display: flex; flex-wrap: wrap; gap: .45rem; align-items: center; padding: .55rem; border-radius: 8px; background: rgba(2, 6, 23, .3); }
.plan-steps { margin: .5rem 0 0 1.25rem; color: #cbd5e1; }
.job-log { max-height: 320px; overflow: auto; white-space: pre-wrap; font-size: .78rem; padding: .75rem; border-radius: 8px; background: rgba(2, 6, 23, .55); }
.migration-record { padding: .65rem 0; border-bottom: 1px solid rgba(148, 163, 184, .18); }
.migration-record:last-child { border-bottom: 0; }
.warn-text { color: #fbbf24; }
</style>
