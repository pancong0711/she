<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  authorizeWorkspace,
  loadWorkspaces,
  removeWorkspace,
  type WorkspaceAuthorization,
  type WorkspaceListResponse,
} from '../api'

const registry = ref<WorkspaceListResponse | null>(null)
const loading = ref(false)
const error = ref('')
const message = ref('')
const label = ref('')
const path = ref('')
const mode = ref<'read-only' | 'read-write'>('read-write')
const removing = ref('')

const writableCount = computed(() => (registry.value?.workspaces ?? []).filter(item => item.mode === 'read-write').length)

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    registry.value = await loadWorkspaces()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

async function add(): Promise<void> {
  if (loading.value) return
  error.value = ''
  message.value = ''
  try {
    registry.value = await authorizeWorkspace({
      label: label.value.trim(),
      path: path.value.trim(),
      mode: mode.value,
    })
    message.value = 'Workspace 授权已保存。'
    label.value = ''
    path.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function remove(item: WorkspaceAuthorization): Promise<void> {
  if (removing.value !== '') return
  if (!window.confirm(`删除 workspace 授权？\n\n${item.path}`)) return
  removing.value = item.id
  error.value = ''
  message.value = ''
  try {
    registry.value = await removeWorkspace(item.id)
    message.value = 'Workspace 授权已删除。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    removing.value = ''
  }
}

function permissionText(item: WorkspaceAuthorization): string {
  return `${item.readable ? 'r' : '-'}${item.writable ? 'w' : '-'}`
}

onMounted(refresh)
</script>

<template>
  <section class="workspace-page">
    <div class="card workspace-intro">
      <div class="section-head">
        <div>
          <p class="eyebrow">WORKSPACE AUTHORIZATION</p>
          <h2>叶子目录授权</h2>
          <p class="muted">
            只登记明确的叶子目录，不授权文件系统根目录、用户 home 本身或受保护系统路径。
            授权记录用于后续 broker 挂载；SHE 只保存路径和权限意图，不读取目录内容。
          </p>
        </div>
        <button class="secondary" :disabled="loading" @click="refresh">{{ loading ? '刷新中…' : '刷新' }}</button>
      </div>
      <div class="workspace-stats">
        <span class="pill">{{ registry?.workspaces.length ?? 0 }} authorized</span>
        <span class="pill">{{ writableCount }} read-write</span>
        <span class="pill">{(registry?.workspaces.length ?? 0) - writableCount} read-only</span>
      </div>
      <p v-if="registry?.path" class="muted small-note">registry: <code>{{ registry.path }}</code></p>
      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="message" class="success-text">{{ message }}</p>
    </div>

    <div class="card">
      <h2>新增授权</h2>
      <div class="workspace-form">
        <label>标签<input v-model="label" placeholder="例如：my-web-project" maxlength="100" /></label>
        <label>绝对目录路径<input v-model="path" placeholder="/home/user/projects/my-web-project" /></label>
        <label>
          权限意图
          <select v-model="mode">
            <option value="read-write">read-write（可写挂载）</option>
            <option value="read-only">read-only（只读挂载）</option>
          </select>
        </label>
        <button class="primary" :disabled="loading || path.trim() === ''" @click="add">授权目录</button>
      </div>
      <p class="muted small-note">
        当前页面只保存授权策略。真正的只读/读写强制发生在通过 broker 创建 sandbox 时；
        worker 的直接 workspace 模式不会因这里选择 read-only 而自动变成只读。
      </p>
    </div>

    <div class="card">
      <h2>已授权目录</h2>
      <p v-if="(registry?.workspaces.length ?? 0) === 0" class="muted">还没有 workspace 授权。</p>
      <div class="workspace-list">
        <article v-for="item in registry?.workspaces" :key="item.id" class="workspace-card">
          <div class="workspace-card-head">
            <div>
              <strong>{{ item.label }}</strong>
              <small>{{ item.id }} · {{ item.mode }}</small>
            </div>
            <span :class="['pill', item.leafAuthorized && item.exists ? 'succeeded' : 'failed']">
              {{ item.leafAuthorized && item.exists ? 'authorized' : 'needs attention' }}
            </span>
          </div>
          <div class="workspace-meta">
            <span>path <b><code>{{ item.path }}</code></b></span>
            <span>realpath <b><code>{{ item.realPath }}</code></b></span>
            <span>permissions <b>{{ permissionText(item) }}</b></span>
            <span>leaf <b>{{ item.leafAuthorized ? 'yes' : 'no' }}</b></span>
          </div>
          <p v-for="warning in item.warnings" :key="warning" class="warn-text">! {{ warning }}</p>
          <button class="secondary danger" :disabled="removing !== ''" @click="remove(item)">
            {{ removing === item.id ? '删除中…' : '删除授权' }}
          </button>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.workspace-page { display: grid; gap: 16px; }
.workspace-intro { background: linear-gradient(135deg, #0c4a6e33, #0f172acc); }
.workspace-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.workspace-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; align-items: end; margin-top: 14px; }
.workspace-form label { display: grid; gap: 6px; }
.workspace-list { display: grid; gap: 10px; margin-top: 14px; }
.workspace-card { border: 1px solid #1e293b; border-radius: 12px; padding: 14px; background: #02061788; }
.workspace-card-head { display: flex; justify-content: space-between; gap: 12px; }
.workspace-card-head strong { display: block; }
.workspace-card-head small { color: #64748b; }
.workspace-meta { display: grid; gap: 6px; margin: 12px 0; font-size: 12px; color: #64748b; }
.workspace-meta b { color: #cbd5e1; font-weight: 500; overflow-wrap: anywhere; }
.danger { border-color: #7f1d1d; color: #fca5a5; }
</style>
