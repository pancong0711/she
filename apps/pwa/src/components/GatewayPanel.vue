<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { loadGatewayStatus, saveGatewayConfig, type GatewayStatus } from '../api'

const status = ref<GatewayStatus | null>(null)
const enabled = ref(false)
const adapterHealthUrl = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')

const controlCapabilities = computed(() => {
  const response = status.value?.controlPlane.response as { capabilities?: { values?: string[] } } | undefined
  return response?.capabilities?.values ?? []
})

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    status.value = await loadGatewayStatus()
    enabled.value = status.value.config.enabled
    adapterHealthUrl.value = status.value.config.adapterHealthUrl
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
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

onMounted(refresh)
</script>

<template>
  <section class="gateway-page">
    <div class="card gateway-hero">
      <div class="section-head">
        <div>
          <p class="eyebrow">GATEWAY / CHANNEL ADAPTER</p>
          <h2>Gateway 配置与 feishu4dsh 连接状态</h2>
          <p class="muted">
            SHE 只消费 gateway.v1 的事件、命令和 RenderIntent。飞书 app secret、verification token、
            encrypt key、tenant token 必须留在 feishu4dsh，不进入 SHE，也不暴露给 agent。
          </p>
        </div>
        <button class="secondary" :disabled="loading" @click="refresh">{{ loading ? '刷新中…' : '刷新状态' }}</button>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="message" class="success-text">{{ message }}</p>
    </div>

    <div class="grid">
      <article class="card">
        <div class="section-head">
          <div>
            <h2>控制面 gateway.v1</h2>
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
            <h2>feishu4dsh adapter</h2>
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
</style>
