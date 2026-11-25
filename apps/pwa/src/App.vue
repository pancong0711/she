<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { GatewayHealth, GatewaySnapshot } from '@she/protocol'
import { loadSnapshot } from './api'

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
let timer: ReturnType<typeof setInterval> | undefined

const tasks = computed(() => [...(snapshot.value?.tasks ?? [])].reverse())
const runningTasks = computed(() => tasks.value.filter(task => ['dispatching', 'submitted', 'running'].includes(task.status)).length)
const failedTasks = computed(() => tasks.value.filter(task => ['failed', 'needs_attention'].includes(task.status)).length)

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const result = await loadSnapshot()
    health.value = result.health
    snapshot.value = result.snapshot
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
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
        <img src="/icons/she.svg" alt="SHE" />
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
        <span :class="['dot', health?.status === 'ok' ? 'ok' : 'bad']"></span>
        {{ health?.status === 'ok' ? 'control plane online' : 'control plane unavailable' }}
      </div>
    </aside>

    <main>
      <header>
        <div>
          <h1>{{ tabs.find(tab => tab.id === active)?.label }}</h1>
          <p>Local-first · gateway.v1 · {{ health?.version ?? 'unknown version' }}</p>
        </div>
        <button class="refresh" :disabled="loading" @click="refresh">
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </button>
      </header>

      <div v-if="error" class="alert">
        <strong>无法连接 SHE control plane</strong>
        <p>{{ error }}</p>
        <p>确认 `she-control-plane` 与本地 PWA server 已启动。</p>
      </div>

      <section v-if="active === 'dashboard'" class="grid">
        <article class="card metric">
          <span>Tasks</span>
          <strong>{{ tasks.length }}</strong>
          <small>{{ runningTasks }} active · {{ failedTasks }} attention</small>
        </article>
        <article class="card metric">
          <span>Protocol</span>
          <strong>{{ health?.protocolVersion ?? '-' }}</strong>
          <small>capabilities: {{ health?.capabilities.values.length ?? 0 }}</small>
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

      <section v-else class="placeholder card">
        <div class="placeholder-icon">◌</div>
        <h2>{{ tabs.find(tab => tab.id === active)?.label }} 页面待接入</h2>
        <p>该模块已纳入 M6；当前先完成本地 PWA、只读控制面状态和任务面板。</p>
        <p class="muted">后续将接入 sandbox broker、软件包安装/更新、workspace 权限和 agent 对话。</p>
      </section>
    </main>
  </div>
</template>
