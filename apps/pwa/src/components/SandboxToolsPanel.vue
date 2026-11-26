<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { SandboxExecResult, SandboxView } from '@she/protocol'
import {
  execSandbox,
  loadSandboxAgentRecipes,
  recordSandboxAgentInstall,
  resolveSandboxAgentVersion,
  type SandboxAgentRecipe,
  type SandboxAgentVersionResolution,
} from '../api'

const props = defineProps<{ sandbox: SandboxView; brokerOnline: boolean }>()

const recipes = ref<readonly SandboxAgentRecipe[]>([])
const recipesError = ref('')
const mode = ref<'closed' | 'install' | 'exec'>('closed')
const selectedRecipeId = ref('opencode')
const commandInput = ref('pwd && ls -la /workspace')
const cwd = ref('/workspace')
const timeoutMs = ref(30_000)
const running = ref(false)
const error = ref('')
const result = ref<SandboxExecResult | null>(null)
const copiedDockerCommand = ref(false)
const versionInput = ref('')
const versionResolution = ref<SandboxAgentVersionResolution | null>(null)
const versionChecking = ref(false)

const selectedRecipe = computed(() => recipes.value.find(item => item.id === selectedRecipeId.value) ?? recipes.value[0])
const canRun = computed(() => props.brokerOnline && props.sandbox.status === 'running' && !running.value)

watch(selectedRecipe, recipe => {
  if (recipe === undefined) return
  versionInput.value = recipe.version
  versionResolution.value = null
})

onMounted(async () => {
  try {
    recipes.value = await loadSandboxAgentRecipes()
  } catch (cause) {
    recipesError.value = cause instanceof Error ? cause.message : String(cause)
  }
})

function open(next: 'install' | 'exec'): void {
  mode.value = mode.value === next ? 'closed' : next
  error.value = ''
  result.value = null
}

async function runShell(command: string, workdir = cwd.value, timeout = timeoutMs.value, cwdLocked?: string): Promise<void> {
  if (!canRun.value) return
  running.value = true
  error.value = ''
  result.value = null
  try {
    result.value = await execSandbox(props.sandbox.name, {
      command: ['sh', '-lc', command],
      cwd: cwdLocked ?? workdir,
      timeoutMs: timeout,
    })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    running.value = false
  }
}

async function checkVersion(): Promise<void> {
  const recipe = selectedRecipe.value
  if (recipe === undefined || versionChecking.value) return
  versionChecking.value = true
  error.value = ''
  try {
    versionResolution.value = await resolveSandboxAgentVersion(recipe.id, versionInput.value.trim())
    if (versionResolution.value.fallback) {
      error.value = versionResolution.value.warning ?? `版本不存在，已回退到 ${versionResolution.value.resolved}`
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    versionChecking.value = false
  }
}

async function installSelected(): Promise<void> {
  const baseRecipe = selectedRecipe.value
  if (baseRecipe === undefined || running.value) return
  running.value = true
  error.value = ''
  result.value = null
  try {
    const resolution = await resolveSandboxAgentVersion(baseRecipe.id, versionInput.value.trim())
    versionResolution.value = resolution
    const recipe = resolution.recipe
    const installed = await execSandbox(props.sandbox.name, {
      command: ['sh', '-lc', recipe.install.command[2] ?? ''],
      cwd: recipe.install.cwd,
      timeoutMs: recipe.install.timeoutMs,
    })
    result.value = installed
    if (installed.exitCode === 0) {
      await recordSandboxAgentInstall({
        agentId: recipe.id,
        version: resolution.resolved,
        success: true,
        sandboxName: props.sandbox.name,
      }).catch(() => undefined)
      recipes.value = recipes.value.map(item => item.id === recipe.id
        ? {
            ...item,
            installedVersions: [
              { version: resolution.resolved, installedAt: Date.now(), sandboxName: props.sandbox.name },
              ...(item.installedVersions ?? []).filter(entry => entry.version !== resolution.resolved),
            ].slice(0, 5),
          }
        : item)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    running.value = false
  }
}

async function verifySelected(): Promise<void> {
  const recipe = versionResolution.value?.recipe ?? selectedRecipe.value
  if (recipe === undefined) return
  await runShell(recipe.verify.command[2] ?? '', recipe.verify.cwd, recipe.verify.timeoutMs, recipe.verify.cwd)
}

async function runCommand(): Promise<void> {
  if (commandInput.value.trim() === '') return
  await runShell(commandInput.value)
}

async function copyDockerCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText(`docker exec -it she-${props.sandbox.name} sh`)
    copiedDockerCommand.value = true
    setTimeout(() => { copiedDockerCommand.value = false }, 1500)
  } catch {
    copiedDockerCommand.value = false
  }
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString()
}
</script>

<template>
  <div class="sandbox-tools">
    <div class="sandbox-tool-actions">
      <button class="secondary" :disabled="!brokerOnline" @click="open('install')">{{ mode === 'install' ? '关闭安装' : '安装 Agent' }}</button>
      <button class="secondary" :disabled="!brokerOnline" @click="open('exec')">{{ mode === 'exec' ? '关闭命令' : '执行命令' }}</button>
      <button class="secondary" :disabled="!brokerOnline" @click="copyDockerCommand">{{ copiedDockerCommand ? '已复制' : '复制 docker exec 命令' }}</button>
    </div>

    <div v-if="sandbox.status !== 'running'" class="alert compact-alert">
      sandbox 当前状态是 <b>{{ sandbox.status }}</b>；安装 agent 或执行命令前需要先启动容器。
    </div>

    <section v-if="mode === 'install'" class="sandbox-tool-panel">
      <div class="section-head">
        <div>
          <h3>在 sandbox 中安装 Agent</h3>
          <p class="muted small-note">
            通过 broker 的 <code>docker exec</code> 在容器内执行，安装到可写的
            <code>/home/agent/.local</code>，不修改只读 rootfs。不会读取宿主凭据。
          </p>
        </div>
      </div>
      <p v-if="recipesError" class="error-text">{{ recipesError }}</p>
      <div class="sandbox-tool-form">
        <label>
          Agent（一级）
          <select v-model="selectedRecipeId">
            <option v-for="recipe in recipes" :key="recipe.id" :value="recipe.id">
              {{ recipe.label }} — {{ recipe.packageName }}
            </option>
          </select>
        </label>
        <label>
          版本（二级，可手填）
          <input v-model="versionInput" list="agent-version-options" :placeholder="selectedRecipe?.version ?? '1.19.6'" />
          <datalist id="agent-version-options">
            <option v-for="item in selectedRecipe?.knownVersions ?? []" :key="`known-${item}`" :value="item">内置推荐版本</option>
            <option v-for="item in selectedRecipe?.installedVersions ?? []" :key="`installed-${item.version}`" :value="item.version">已成功安装</option>
            <option v-if="selectedRecipe" :value="selectedRecipe.version">默认</option>
          </datalist>
        </label>
        <label>
          命令 cwd
          <input v-model="cwd" placeholder="/workspace" />
        </label>
        <label>
          timeout (ms)
          <input v-model.number="timeoutMs" type="number" min="1000" max="300000" step="1000" />
        </label>
      </div>
      <div v-if="selectedRecipe" class="recipe-info">
        <p>{{ selectedRecipe.description }}</p>
        <p class="muted small-note">镜像建议：<code>{{ selectedRecipe.image }}</code>；版本目录：<code>/home/agent/.agents/{{ selectedRecipe.id }}/&lt;version&gt;</code>；当前链接：<code>/home/agent/.local/bin/{{ selectedRecipe.binary }}</code></p>
        <ul>
          <li v-for="requirement in selectedRecipe.requirements" :key="requirement">{{ requirement }}</li>
        </ul>
        <p v-for="note in selectedRecipe.notes" :key="note" class="muted small-note">• {{ note }}</p>
        <p v-if="selectedRecipe.exampleCommand" class="muted small-note">验证示例：<code>{{ selectedRecipe.exampleCommand }}</code></p>
      </div>
      <div class="version-resolution" v-if="versionResolution">
        <p>
          请求版本 <code>{{ versionResolution.requested }}</code>
          → 解析版本 <code>{{ versionResolution.resolved }}</code>
          <span :class="['pill', versionResolution.exact ? 'succeeded' : 'warn']">{{ versionResolution.exact ? 'exact' : 'fallback to latest' }}</span>
          <span :class="['pill', versionResolution.verified ? 'succeeded' : 'warn']">{{ versionResolution.verified ? 'registry verified' : 'registry unavailable' }}</span>
        </p>
        <p v-if="versionResolution.warning" class="warn-text small-note">{{ versionResolution.warning }}</p>
        <p class="muted small-note">可用稳定版本（最近 30 个）：{{ versionResolution.availableVersions.slice(0, 12).join(', ') }}{{ versionResolution.availableVersions.length > 12 ? ' …' : '' }}</p>
      </div>
      <div class="job-actions">
        <button class="secondary" :disabled="!canRun || selectedRecipe === undefined || versionChecking" @click="checkVersion">
          {{ versionChecking ? '校验中…' : '校验版本' }}
        </button>
        <button class="primary" :disabled="!canRun || selectedRecipe === undefined" @click="installSelected">
          {{ running ? '安装中…' : '安装并验证' }}
        </button>
        <button class="secondary" :disabled="!canRun || selectedRecipe === undefined" @click="verifySelected">仅验证</button>
      </div>
      <p class="muted small-note">成功安装的版本会记录到 companion 的 agent 版本注册表，每个 agent 默认保留最近 5 个成功版本。</p>
    </section>

    <section v-if="mode === 'exec'" class="sandbox-tool-panel">
      <div class="section-head">
        <div>
          <h3>在 sandbox 中执行命令</h3>
          <p class="muted small-note">
            当前是一次性命令执行，不是完整 PTY 终端。命令会作为
            <code>sh -lc &lt;command&gt;</code> 在容器内执行；broker 是唯一调用 Docker 的组件。
          </p>
        </div>
      </div>
      <div class="sandbox-tool-form">
        <label class="wide-label">
          命令
          <textarea v-model="commandInput" rows="3" placeholder="pwd && ls -la /workspace && opencode --version"></textarea>
        </label>
        <label>
          cwd
          <input v-model="cwd" placeholder="/workspace" />
        </label>
        <label>
          timeout (ms)
          <input v-model.number="timeoutMs" type="number" min="1000" max="300000" step="1000" />
        </label>
      </div>
      <div class="job-actions">
        <button class="primary" :disabled="!canRun || commandInput.trim() === ''" @click="runCommand">
          {{ running ? '执行中…' : '执行命令' }}
        </button>
      </div>
    </section>

    <p v-if="error" class="error-text">{{ error }}</p>
    <div v-if="result" class="exec-result">
      <div class="exec-result-head">
        <span :class="['pill', result.exitCode === 0 ? 'succeeded' : 'failed']">exit {{ result.exitCode }}</span>
        <span class="muted small-note">
          {{ formatTime(result.startedAt) }} → {{ formatTime(result.finishedAt) }}
          <template v-if="result.timedOut"> · timed out</template>
          <template v-if="result.truncated"> · output truncated</template>
        </span>
      </div>
      <pre v-if="result.stdout"><code>{{ result.stdout }}</code></pre>
      <pre v-if="result.stderr" class="stderr-output"><code>{{ result.stderr }}</code></pre>
      <p v-if="!result.stdout && !result.stderr" class="muted small-note">命令没有输出，退出码 {{ result.exitCode }}。</p>
    </div>
  </div>
</template>

<style scoped>
.sandbox-tools { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #334155; display: grid; gap: 10px; }
.sandbox-tool-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.sandbox-tool-panel { padding: 12px; border: 1px solid #334155; border-radius: 10px; background: #02061788; display: grid; gap: 10px; }
.sandbox-tool-panel h3 { margin: 0; font-size: 14px; }
.sandbox-tool-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
.sandbox-tool-form label { display: grid; gap: 5px; color: #94a3b8; font-size: 12px; }
.sandbox-tool-form .wide-label { grid-column: 1 / -1; }
.recipe-info { padding: 10px; border-radius: 8px; background: #0f172a; }
.recipe-info p { margin: 6px 0; color: #cbd5e1; font-size: 12px; }
.recipe-info ul { margin: 6px 0 0; padding-left: 18px; color: #94a3b8; font-size: 12px; }
.version-resolution { padding: 10px; border-radius: 8px; background: #0f172a; }
.version-resolution p { margin: 4px 0; font-size: 12px; color: #cbd5e1; }
.compact-alert { margin: 0; padding: 10px 12px; font-size: 12px; }
.exec-result { padding: 10px; border: 1px solid #334155; border-radius: 10px; background: #020617; }
.exec-result-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.exec-result pre { max-height: 260px; margin: 8px 0 0; overflow: auto; }
.stderr-output code { color: #fca5a5; }
</style>
