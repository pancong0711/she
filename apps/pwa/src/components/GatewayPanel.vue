<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  FEISHU4DSH_SOURCE_URL,
  controlFeishuGateway,
  loadFeishu4dshStatus,
  loadFeishuGatewayStatus,
  loadGatewayStatus,
  saveFeishuGatewayConfig,
  saveGatewayConfig,
  startJob,
  streamJobEvents,
  type Feishu4dshStatus,
  type FeishuGatewayStatus,
  type GatewayStatus,
  type JobEvent,
} from '../api'

const status = ref<GatewayStatus | null>(null)
const feishuSetup = ref<Feishu4dshStatus | null>(null)
const enabled = ref(false)
const adapterHealthUrl = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')
const setupError = ref('')
const installProfile = ref('feishu4dsh')
const installSource = ref(FEISHU4DSH_SOURCE_URL)
const installing = ref(false)
const installEvents = ref<JobEvent[]>([])
const copiedCommand = ref('')
const directGateway = ref<FeishuGatewayStatus | null>(null)
const directGatewayError = ref('')
const directGatewayMessage = ref('')
const directGatewayBusy = ref('')
const feishuAppId = ref('')
const feishuAppSecret = ref('')
const feishuDomain = ref<'feishu' | 'lark'>('feishu')
const feishuRequireMention = ref(true)
const feishuAllowedOpenIds = ref('')
const feishuAllowedChatIds = ref('')

const controlCapabilities = computed(() => {
  const response = status.value?.controlPlane.response as { capabilities?: { values?: string[] } } | undefined
  return response?.capabilities?.values ?? []
})

const installLog = computed(() => installEvents.value
  .map(event => {
    if (event.type === 'log') return `[${event.stream}] ${event.text}`
    if (event.type === 'system') return event.text
    if (event.type === 'check') return `${event.status}: ${event.label} — ${event.detail}`
    if (event.type === 'status') return `status: ${event.status}`
    if (event.type === 'done') return `done: ${event.status} exit=${event.exitCode}`
    return ''
  })
  .filter(Boolean)
  .join('\n'))

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  setupError.value = ''
  const [gatewayResult, setupResult, directResult] = await Promise.allSettled([
    loadGatewayStatus(),
    loadFeishu4dshStatus(),
    loadFeishuGatewayStatus(),
  ])
  if (gatewayResult.status === 'fulfilled') {
    status.value = gatewayResult.value
    enabled.value = gatewayResult.value.config.enabled
    adapterHealthUrl.value = gatewayResult.value.config.adapterHealthUrl
  } else {
    error.value = gatewayResult.reason instanceof Error ? gatewayResult.reason.message : String(gatewayResult.reason)
  }
  if (setupResult.status === 'fulfilled') {
    feishuSetup.value = setupResult.value
    installProfile.value = setupResult.value.profile.name
  } else {
    feishuSetup.value = null
    setupError.value = setupResult.reason instanceof Error ? setupResult.reason.message : String(setupResult.reason)
  }
  if (directResult.status === 'fulfilled') {
    directGateway.value = directResult.value
    feishuAppId.value = directResult.value.envFile.appId
    feishuDomain.value = directResult.value.envFile.domain
    feishuRequireMention.value = directResult.value.envFile.requireMention
    feishuAllowedOpenIds.value = directResult.value.envFile.allowedOpenIds
    feishuAllowedChatIds.value = directResult.value.envFile.allowedChatIds
    directGatewayError.value = ''
  } else {
    directGateway.value = null
    directGatewayError.value = directResult.reason instanceof Error ? directResult.reason.message : String(directResult.reason)
  }
  loading.value = false
}

async function saveAndConnectDirectGateway(): Promise<void> {
  if (directGatewayBusy.value !== '') return
  directGatewayBusy.value = 'save'
  directGatewayError.value = ''
  directGatewayMessage.value = ''
  try {
    directGateway.value = await saveFeishuGatewayConfig({
      appId: feishuAppId.value.trim(),
      appSecret: feishuAppSecret.value,
      domain: feishuDomain.value,
      requireMention: feishuRequireMention.value,
      allowedOpenIds: feishuAllowedOpenIds.value.trim(),
      allowedChatIds: feishuAllowedChatIds.value.trim(),
    })
    feishuAppSecret.value = ''
    directGatewayBusy.value = 'start'
    directGateway.value = await controlFeishuGateway('start')
    directGatewayMessage.value = 'Feishu 凭据已保存到 0600 文件，内置 Feishu gateway 已启动。'
  } catch (cause) {
    directGatewayError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    directGatewayBusy.value = ''
  }
}

async function stopDirectGateway(): Promise<void> {
  if (directGatewayBusy.value !== '') return
  directGatewayBusy.value = 'stop'
  directGatewayError.value = ''
  directGatewayMessage.value = ''
  try {
    directGateway.value = await controlFeishuGateway('stop')
    directGatewayMessage.value = '内置 Feishu gateway 已停止。'
  } catch (cause) {
    directGatewayError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    directGatewayBusy.value = ''
  }
}

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    status.value = await saveGatewayConfig({ enabled: enabled.value, adapterHealthUrl: adapterHealthUrl.value.trim() })
    message.value = 'Gateway 配置已保存；未执行任何飞书 secret 读取或系统安装。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    saving.value = false
  }
}

async function installFeishu4dsh(): Promise<void> {
  if (installing.value) return
  const confirmed = window.confirm(
    '这会在当前用户的 dsh profile 中执行 pnpm 安装，不会使用 sudo，也不会读取飞书 secret。继续吗？\n\n'
    + `profile: ${installProfile.value}\nsource: ${installSource.value.trim()}`,
  )
  if (!confirmed) return
  installing.value = true
  setupError.value = ''
  installEvents.value = []
  try {
    const job = await startJob('feishu4dsh-install', {
      profile: installProfile.value.trim(),
      packageSpec: installSource.value.trim(),
    })
    for await (const event of streamJobEvents(job.id)) installEvents.value = [...installEvents.value, event]
    await refresh()
  } catch (cause) {
    setupError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    installing.value = false
  }
}

async function copyCommand(command: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(command)
    copiedCommand.value = command
    setTimeout(() => { if (copiedCommand.value === command) copiedCommand.value = '' }, 1500)
  } catch {
    copiedCommand.value = ''
  }
}

onMounted(refresh)
</script>

<template>
  <section class="gateway-page">
    <div class="card gateway-hero">
      <div class="section-head">
        <div>
          <p class="eyebrow">GATEWAY / CHANNEL ADAPTER</p>
          <h2>Gateway / Feishu 连接</h2>
          <p class="muted">
            首选架构是外部 feishu4dsh standalone gateway 通过 gateway.v1 直连 SHE。
            下方内置 Feishu gateway 已标记为 legacy，仅用于旧部署兼容；飞书凭据始终只保存在本地 0600 文件，
            core、worker 和 agent 不读取，也不暴露给模型。
          </p>
        </div>
        <button class="secondary" :disabled="loading" @click="refresh">{{ loading ? '刷新中…' : '刷新状态' }}</button>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="message" class="success-text">{{ message }}</p>
    </div>

    <article class="card wide direct-feishu-card">
      <div class="section-head">
        <div>
          <p class="eyebrow">LEGACY BUILT-IN FEISHU CHANNEL</p>
          <h2>内置 Feishu gateway（legacy / 兼容模式）</h2>
          <p class="muted">
            该内置 gateway 已进入退役路线。新部署应使用 feishu4dsh standalone gateway →
            gateway.v1 → SHE control plane。这里保留启动/停止能力，仅用于旧部署迁移和兼容。
            凭据写入 <code>SHE_HOME/config/feishu.env</code>（0600），core/agent 不读取该文件。
          </p>
        </div>
        <span :class="['pill', directGateway?.runtime.running ? 'succeeded' : directGateway?.envFile.appSecretConfigured ? 'warn' : 'failed']">
          {{ directGateway?.runtime.running ? 'connected' : directGateway?.envFile.appSecretConfigured ? 'configured / stopped' : 'not configured' }}
        </span>
      </div>
      <p v-if="directGatewayError" class="error-text">{{ directGatewayError }}</p>
      <p v-if="directGatewayMessage" class="success-text">{{ directGatewayMessage }}</p>
      <div v-if="directGateway" class="gateway-form direct-feishu-form">
        <label>
          Feishu App ID
          <input v-model="feishuAppId" placeholder="cli_xxxxxxxx" />
        </label>
        <label>
          Feishu App Secret
          <input v-model="feishuAppSecret" type="password" :placeholder="directGateway.envFile.appSecretConfigured ? '已保存；留空保持不变' : '输入 App Secret'" autocomplete="new-password" />
        </label>
        <label>
          Domain
          <select v-model="feishuDomain">
            <option value="feishu">Feishu（飞书）</option>
            <option value="lark">Lark</option>
          </select>
        </label>
        <label class="check-row"><input v-model="feishuRequireMention" type="checkbox" /> 群聊中必须 @ 机器人</label>
        <label>
          允许的 sender open_id（逗号分隔，留空不限制）
          <input v-model="feishuAllowedOpenIds" placeholder="ou_xxx,ou_yyy" />
        </label>
        <label>
          允许的 chat_id（逗号分隔，留空不限制）
          <input v-model="feishuAllowedChatIds" placeholder="oc_xxx" />
        </label>
      </div>
      <div v-if="directGateway" class="health-grid">
        <div><span>env file</span><b><code>{{ directGateway.envFile.path }}</code></b></div>
        <div><span>mode</span><b>{{ directGateway.envFile.mode === undefined ? '-' : `0${directGateway.envFile.mode.toString(8)}` }}</b></div>
        <div><span>app id</span><b>{{ directGateway.envFile.appIdConfigured ? directGateway.envFile.appId : 'missing' }}</b></div>
        <div><span>app secret</span><b>{{ directGateway.envFile.appSecretConfigured ? 'saved (value never returned)' : 'missing' }}</b></div>
        <div><span>process</span><b>{{ directGateway.runtime.running ? `running pid=${directGateway.runtime.pid}` : 'stopped' }}</b></div>
        <div v-if="directGateway.runtime.lastError"><span>last error</span><b class="error-text">{{ directGateway.runtime.lastError }}</b></div>
      </div>
      <div class="job-actions">
        <button class="primary" :disabled="directGatewayBusy !== ''" @click="saveAndConnectDirectGateway">
          {{ directGatewayBusy === 'save' ? '保存中…' : directGatewayBusy === 'start' ? '连接中…' : '保存并连接飞书' }}
        </button>
        <button v-if="directGateway?.runtime.running" class="secondary" :disabled="directGatewayBusy !== ''" @click="stopDirectGateway">
          {{ directGatewayBusy === 'stop' ? '停止中…' : '停止 Feishu gateway' }}
        </button>
        <button class="secondary" :disabled="loading" @click="refresh">刷新状态</button>
      </div>
      <details v-if="directGateway?.runtime.logs.length" class="gateway-command-help">
        <summary>查看 gateway 日志（不包含 App Secret）</summary>
        <pre><code>{{ directGateway.runtime.logs.map(item => `${new Date(item.at).toLocaleTimeString()} [${item.stream}] ${item.text}`).join('\n') }}</code></pre>
      </details>
      <p class="muted small-note">
        首次启动后，在飞书里给机器人发 <code>/she help</code>。当前内置 gateway 支持文本命令和任务
        accepted/completed/failed 回传；卡片审批和文件回传仍属于后续增强。
      </p>
    </article>

    <article class="card wide">
      <div class="section-head">
        <div>
          <h2>外部 feishu4dsh adapter（可选，不默认依赖）</h2>
          <p class="muted">
            以下配置仅供已经单独部署 feishu4dsh 的高级用户检查；SHE 不要求安装 dsh 或 feishu4dsh。
          </p>
        </div>
      </div>
    </article>

    <article class="card wide">
      <div class="section-head">
        <div>
          <h2>1. 安装与连接前置条件</h2>
          <p class="muted">
            feishu4dsh 是独立的 dsh 通道插件。安装它只完成“飞书 ↔ dsh”的通道；SHE 的 gateway.v1
            适配仍需要 feishu4dsh 侧接入并通过真机联调，当前不能因为插件存在就宣称已经连通 SHE。
          </p>
        </div>
        <span :class="['pill', feishuSetup?.prerequisitesReady ? 'succeeded' : 'warn']">
          {{ feishuSetup?.prerequisitesReady ? '飞书通道前置条件就绪' : '前置条件未齐' }}
        </span>
      </div>

      <p v-if="setupError" class="error-text">{{ setupError }}</p>
      <div v-if="feishuSetup" class="health-grid">
        <div><span>dsh</span><b>{{ feishuSetup.dsh.available ? feishuSetup.dsh.version || 'available' : (feishuSetup.dsh.detail || 'not found') }}</b></div>
        <div><span>profile</span><b><code>{{ feishuSetup.profile.directory }}</code></b></div>
        <div><span>plugin</span><b>{{ feishuSetup.profile.pluginInstalled ? `installed (${feishuSetup.profile.dependencySpec})` : 'not installed' }}</b></div>
        <div><span>env file</span><b><code>{{ feishuSetup.envFile.path }}</code></b></div>
        <div><span>file mode</span><b>{{ feishuSetup.envFile.mode === undefined ? '-' : `0${feishuSetup.envFile.mode.toString(8)}` }}</b></div>
        <div><span>app id var</span><b>{{ feishuSetup.envFile.appIdConfigured ? 'configured (name only)' : 'missing' }}</b></div>
        <div><span>app secret var</span><b>{{ feishuSetup.envFile.appSecretConfigured ? 'configured (name only; value never read)' : 'missing' }}</b></div>
        <div><span>user service</span><b>{{ feishuSetup.service.active ? 'active' : feishuSetup.service.unitExists ? 'installed / inactive' : 'not installed' }}</b></div>
      </div>

      <div class="gateway-form">
        <label>
          dsh profile
          <input v-model="installProfile" placeholder="feishu4dsh" />
        </label>
        <label>
          安装源（npm 包名、git URL 或本地路径）
          <input v-model="installSource" placeholder="git+https://github.com/pancong0711/feishu4dsh.git" />
        </label>
      </div>
      <div class="job-actions">
        <button class="primary" :disabled="installing" @click="installFeishu4dsh">
          {{ installing ? '安装中…' : '在 dsh profile 中安装/更新 feishu4dsh' }}
        </button>
        <button class="secondary" @click="copyCommand(feishuSetup?.commands.installPlugin ?? `dsh plugin --profile ${installProfile} add ${installSource}`)">
          {{ copiedCommand ? '已复制' : '复制安装命令' }}
        </button>
      </div>
      <p class="muted small-note">
        安装按钮只执行 <code>dsh plugin --profile &lt;profile&gt; add &lt;source&gt;</code>，不会使用 sudo，
        不会写飞书 secret，也不会安装/启动 systemd 服务。安装完成后仍需配置 feishu4dsh 自己的 0600 环境文件和用户服务。
      </p>
      <pre v-if="installLog" class="job-log">{{ installLog }}</pre>

      <div class="gateway-boundary-list">
        <p><b>接下来由你本人完成：</b></p>
        <ol>
          <li>在飞书开放平台创建自建应用，取得 App ID / App Secret。</li>
          <li>把凭据写入 <code>~/.config/feishu4dsh/feishu4dsh.env</code>，权限 <code>0600</code>；不要把 secret 填进 SHE。</li>
          <li>按 feishu4dsh 文档配置 profile patch，并安装/启动用户服务。</li>
          <li>完成 feishu4dsh 的 gateway.v1 adapter 接入（T4.6）。当前 SHE 侧协议和 client 已就绪，但 adapter 实际 patch/真机验收尚未完成。</li>
        </ol>
      </div>
      <details class="gateway-command-help">
        <summary>查看手动步骤与排障命令</summary>
        <pre><code>{{ feishuSetup?.commands.installPlugin ?? `dsh plugin --profile ${installProfile} add ${installSource}` }}
# 在 feishu4dsh 部署目录中检查 systemd user service
{{ feishuSetup?.commands.installService ?? 'bash scripts/install-user-services.sh --dry-run' }}
{{ feishuSetup?.commands.enableService ?? 'bash scripts/install-user-services.sh --enable' }}
{{ feishuSetup?.commands.logs ?? 'journalctl --user -u dsh-feishu4dsh.service -f' }}</code></pre>
        <p v-for="note in feishuSetup?.notes ?? []" :key="note" class="muted small-note">• {{ note }}</p>
      </details>
    </article>

    <div class="grid">
      <article class="card">
        <div class="section-head">
          <div>
            <h2>2. 控制面 gateway.v1</h2>
            <p class="muted">control plane 必须可达，gateway adapter 才能提交事件和接收任务事件。</p>
          </div>
          <span :class="['pill', status?.controlPlane.reachable ? 'succeeded' : 'failed']">
            {{ status?.controlPlane.reachable ? 'reachable' : 'offline' }}
          </span>
        </div>
        <div v-if="status" class="health-grid">
          <div><span>HTTP</span><b>{{ status.controlPlane.httpStatus ?? '-' }}</b></div>
          <div><span>protocol</span><b>{{ (status.controlPlane.response as any)?.protocolVersion ?? '-' }}</b></div>
          <div><span>capabilities</span><b>{{ controlCapabilities.length }}</b></div>
          <div v-if="status.controlPlane.error"><span>error</span><b class="error-text">{{ status.controlPlane.error }}</b></div>
        </div>
        <div v-if="controlCapabilities.length > 0" class="capability-list">
          <span v-for="capability in controlCapabilities" :key="capability" class="pill">{{ capability }}</span>
        </div>
        <p v-if="!status?.controlPlane.reachable" class="warn-text">请先安装并启动 Core；Gateway 页面只展示状态，不会启动 core。</p>
      </article>

      <article class="card">
        <div class="section-head">
          <div>
            <h2>3. feishu4dsh adapter health</h2>
            <p class="muted">配置一个 loopback health URL；SHE 不读取 adapter secret，也不启动 feishu4dsh 进程。</p>
          </div>
          <span :class="['pill', status?.adapter.reachable ? 'succeeded' : status?.config.enabled ? 'failed' : 'warn']">
            {{ status?.adapter.reachable ? 'connected' : status?.config.enabled ? 'unreachable' : 'disabled' }}
          </span>
        </div>
        <div class="gateway-form">
          <label class="check-row"><input v-model="enabled" type="checkbox" /> 启用 feishu4dsh adapter 配置</label>
          <label>
            Adapter health URL
            <input v-model="adapterHealthUrl" placeholder="http://127.0.0.1:9090/health" />
          </label>
        </div>
        <div class="job-actions">
          <button class="primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存配置并检查' }}</button>
        </div>
        <div v-if="status" class="health-grid">
          <div><span>configured</span><b>{{ status.adapter.configured ? 'yes' : 'no' }}</b></div>
          <div><span>reachable</span><b>{{ status.adapter.reachable ? 'yes' : 'no' }}</b></div>
          <div><span>HTTP</span><b>{{ status.adapter.httpStatus ?? '-' }}</b></div>
          <div v-if="status.adapter.detail"><span>detail</span><b>{{ status.adapter.detail }}</b></div>
        </div>
        <p class="muted small-note">
          health URL 只允许 127.0.0.1 / localhost / ::1；配置只保存 URL 和 enabled，不保存任何飞书密钥。
          如果 feishu4dsh 还没有提供统一 health endpoint，这里会显示 unreachable，这不代表飞书消息链路一定不可用。
        </p>
      </article>

      <article class="card wide">
        <h2>Secret boundary</h2>
        <p class="muted">{{ status?.secretBoundary.note ?? '飞书 secret 由 feishu4dsh 持有。' }}</p>
        <ul class="gateway-boundary-list">
          <li>SHE 不读取飞书 secret 文件；</li>
          <li>SHE 不把飞书 token 传给 agent；</li>
          <li>agent 只看到 gateway 渲染后的文本/卡片/文件意图；</li>
          <li>真正的飞书签名校验、解密、token refresh 由 feishu4dsh 负责。</li>
        </ul>
      </article>
    </div>
  </section>
</template>

<style scoped>
.gateway-page { display: grid; gap: 16px; }
.gateway-hero { background: linear-gradient(135deg, #0c4a6e33, #0f172acc); }
.capability-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.gateway-form { display: grid; gap: 12px; margin: 14px 0; }
.gateway-form label { display: grid; gap: 6px; }
.gateway-boundary-list { color: #94a3b8; line-height: 1.8; }
.gateway-boundary-list ol { margin: 8px 0 0; padding-left: 20px; }
.gateway-command-help { margin-top: 14px; padding: 12px; border: 1px dashed #475569; border-radius: 10px; }
.gateway-command-help summary { color: #fbbf24; cursor: pointer; font-weight: 600; }
.job-log { white-space: pre-wrap; max-height: 260px; overflow: auto; }
</style>
