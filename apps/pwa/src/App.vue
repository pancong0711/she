<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { GatewayHealth, GatewaySnapshot } from '@she/protocol'
import {
  INSTALL_COMMANDS,
  REPO_URL,
  getCompanionUrl,
  isLocalOrigin,
  loadSnapshot,
  setCompanionUrl,
} from './api'

type Tab = 'dashboard' | 'tasks' | 'sandboxes' | 'packages' | 'gateway' | 'settings'

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'sandboxes', label: 'Sandboxes' },
  { id: 'packages', label: 'Packages' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'settings', label: 'Settings' },
]

const active = ref<Tab>('dashboard')
const health = ref<GatewayHealth | null>(null)
const snapshot = ref<GatewaySnapshot | null>(null)
const error = ref('')
const loading = ref(false)
const remoteMode = !isLocalOrigin()
const iconUrl = `${import.meta.env.BASE_URL}icons/she.svg`
const companionUrl = ref(getCompanionUrl())
const copied = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

const tasks = computed(() => [...(snapshot.value?.tasks ?? [])].reverse())
const runningTasks = computed(() => tasks.value.filter(task => ['dispatching', 'submitted', 'running'].includes(task.status)).length)
const failedTasks = computed(() => tasks.value.filter(task => ['failed', 'needs_attention'].includes(task.status)).length)
const online = computed(() => health.value?.status === 'ok')

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const result = await loadSnapshot()
    health.value = result.health
    snapshot.value = result.snapshot
    error.value = ''
  } catch (cause) {
    health.value = null
    snapshot.value = null
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
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

function relativeTime(at?: number): string {
  if (at === undefined) return '-'
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return `${String(seconds)}s ago`
  if (seconds < 3600) return `${String(Math.round(seconds / 60))}m ago`
  return `${String(Math.round(seconds / 3600))}h ago`
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
        <span :class="['dot', online ? 'ok' : 'bad']"></span>
        {{ online ? 'companion online' : remoteMode ? 'companion offline' : 'control plane offline' }}
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

      <section v-if="!health" class="onboarding">
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
            <p>运行 PWA host，它会把本地控制面 API 暴露给这个页面。</p>
          </article>
          <article class="card step">
            <span class="step-no">03</span>
            <h3>连接并开始使用</h3>
            <p>保持 companion 运行，在设置页确认地址后即可管理 agent。</p>
          </article>
        </div>

        <div class="card install-card">
          <div class="install-head">
            <div>
              <h3>本机启动命令</h3>
              <p class="muted">需要 Node.js 22.19+ 与 pnpm 11.22+。</p>
            </div>
            <button class="secondary" @click="copyInstallCommands">{{ copied ? '已复制' : '复制命令' }}</button>
          </div>
          <pre><code>{{ INSTALL_COMMANDS.join('\n') }}</code></pre>
          <p class="muted">
            启动后打开 <code>http://127.0.0.1:8787</code> 即为同源完整模式。
            当前页面也可以通过下面的 companion 地址连接。
          </p>
        </div>

        <div class="card connect-card">
          <h3>连接本地 companion</h3>
          <div class="connect-row">
            <input v-model="companionUrl" placeholder="http://127.0.0.1:8787" />
            <button class="primary" :disabled="loading" @click="connectCompanion">连接</button>
          </div>
          <p v-if="error" class="error-text">连接失败：{{ error }}</p>
          <p class="muted">
            如果浏览器阻止访问本地地址，请确认 companion 正在运行，并允许此站点访问本地网络。
          </p>
        </div>
      </section>

      <template v-else>
        <div v-if="error" class="alert">
          <strong>无法连接 SHE companion</strong>
          <p>{{ error }}</p>
        </div>

        <section v-if="active === 'dashboard'" class="grid">
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
        </section>

        <section v-else-if="active === 'tasks'" class="card">
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
        </section>

        <section v-else-if="active === 'settings'" class="card settings-card">
          <h2>本地 companion</h2>
          <p class="muted">当前页面通过 companion 访问本机 SHE control plane。</p>
          <label for="companion">Companion URL</label>
          <div class="connect-row">
            <input id="companion" v-model="companionUrl" placeholder="http://127.0.0.1:8787" />
            <button class="primary" :disabled="loading" @click="connectCompanion">保存并测试</button>
          </div>
          <div class="status-box">
            <span :class="['dot', online ? 'ok' : 'bad']"></span>
            <span>{{ online ? '已连接' : '未连接' }}</span>
            <span class="muted">{{ remoteMode ? 'GitHub Pages → local companion' : '本地同源模式' }}</span>
          </div>
          <p class="muted">
            普通用户应优先直接打开 <code>http://127.0.0.1:8787</code>，同源模式无需额外配置 CORS。
          </p>
        </section>

        <section v-else class="placeholder card">
          <div class="placeholder-icon">◌</div>
          <h2>{{ tabs.find(tab => tab.id === active)?.label }} 页面待接入</h2>
          <p>该模块已纳入 M6；当前先完成本地 PWA、只读控制面状态和任务面板。</p>
          <p class="muted">后续将接入 sandbox broker、软件包安装/更新、workspace 权限和 agent 对话。</p>
        </section>
      </template>
    </main>
  </div>
</template>
