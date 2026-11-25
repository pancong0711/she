<script setup lang="ts">
import { REPO_URL } from '../api'

defineProps<{
  companionVersion?: string
  controlVersion?: string
  brokerVersion?: string
}>()
</script>

<template>
  <div class="help-page">
    <article class="card help-hero">
      <p class="eyebrow">SHE HELP</p>
      <h2>这个页面是什么？</h2>
      <p>
        SHE 是 local-first 的 agent control plane。GitHub Pages 上的 PWA 只是可视化界面；
        真正的 control plane、sandbox broker、agent runtime 和 Docker 运行在用户自己的电脑上。
        浏览器通过本机 <code>127.0.0.1</code> 上的 <strong>companion</strong> 连接这些本地服务。
      </p>
      <div class="version-row">
        <span>PWA</span><b>0.1.0</b>
        <span>Companion</span><b>{{ companionVersion ?? 'offline' }}</b>
        <span>Control plane</span><b>{{ controlVersion ?? 'offline' }}</b>
        <span>Broker</span><b>{{ brokerVersion ?? 'offline' }}</b>
      </div>
    </article>

    <article class="card">
      <h2>两种使用模式</h2>
      <div class="help-grid">
        <div>
          <h3>GitHub Pages + companion</h3>
          <p class="muted">
            打开 <code>https://pancong0711.github.io/she/</code>，在 Install &amp; Doctor 中启动并连接
            本机 companion。适合安装到桌面、远程查看和引导首次安装。
          </p>
        </div>
        <div>
          <h3>本地同源模式（推荐）</h3>
          <p class="muted">
            启动 companion 后直接打开 <code>http://127.0.0.1:8787</code>。
            页面与本地 API 同源，不需要跨域配置，稳定性最好。
          </p>
        </div>
      </div>
    </article>

    <article class="card">
      <h2>Install &amp; Doctor 能做什么</h2>
      <dl>
        <dt>环境检查</dt>
        <dd>检查当前用户、Node.js、pnpm、git、Docker、构建产物和 socket 状态。只读，不安装。</dd>
        <dt>用户级环境准备</dt>
        <dd>不请求 root，只在当前用户目录准备 pnpm 等无需管理员权限的组件；不会安装 Docker。</dd>
        <dt>安装依赖</dt>
        <dd>先自动执行 preflight。Node/pnpm 等 fail 项存在时立即中止，不会进入半安装状态。</dd>
        <dt>构建 PWA / 构建全部 / 运行测试</dt>
        <dd>执行仓库中固定的白名单命令，并把 stdout/stderr 实时显示在日志面板。</dd>
      </dl>
      <p class="muted">
        检查结果中的 <code>ok</code> 表示通过，<code>warn</code> 表示允许继续但功能可能降级，
        <code>fail</code> 表示安装会被阻断。
      </p>
    </article>

    <article class="card policy-help">
      <h2>Root / sudo 策略</h2>
      <p>
        SHE 不执行 sudo，不请求 root，不保存 root 或 sudo 凭据。需要管理员权限的操作
        （例如安装系统 Docker、初始化 rootless Docker、修改 subuid/subgid、启用 linger、
        把用户加入 docker 组）只会在界面和文档中说明方法，由用户本人完成。
      </p>
      <p>
        SHE 自身、control plane、broker、agent 和 sandbox 数据都在当前普通用户下运行。
        如果 Docker 访问依赖 docker 组，界面会提示它可能是 root-equivalent，不会把它伪装成
        rootless 安全边界。
      </p>
    </article>

    <article class="card">
      <h2>Sandbox 模型</h2>
      <ul>
        <li>所有 sandbox 数据位于当前用户可管理的 <code>$XDG_DATA_HOME/she/sandboxes</code>。</li>
        <li>broker 是唯一调用 Docker runtime 的组件，agent 不直接接触 Docker socket。</li>
        <li>每个 sandbox 有独立 workspace/inbox/outbox/home/cache/logs。</li>
        <li>用户已配置好的 rootless Docker 可以被使用，但 SHE 不负责初始化 rootless。</li>
        <li>Sandboxes 页面只显示 broker registry 中的只读信息和按需 stats。</li>
      </ul>
    </article>

    <article class="card">
      <h2>状态与页面说明</h2>
      <table>
        <thead><tr><th>页面</th><th>当前能力</th></tr></thead>
        <tbody>
          <tr><td>Dashboard</td><td>control plane health、task/sandbox 计数、最近任务。</td></tr>
          <tr><td>Tasks</td><td>只读 task snapshot；写任务后续接入。</td></tr>
          <tr><td>Sandboxes</td><td>broker 列表、状态、角色、image、按需 CPU/内存/PIDs。</td></tr>
          <tr><td>Packages</td><td>软件包目录、下载、校验、显式确认安装/更新：开发中。</td></tr>
          <tr><td>Gateway</td><td>飞书等 channel adapter 配置：开发中，feishu4dsh 为第一个目标。</td></tr>
          <tr><td>Settings</td><td>companion URL 与三类服务连接状态。</td></tr>
          <tr><td>Help</td><td>本页：概念、边界、操作说明和故障排查。</td></tr>
        </tbody>
      </table>
    </article>

    <article class="card">
      <h2>常见问题</h2>
      <dl>
        <dt>“Companion offline”</dt>
        <dd>本机 companion 没启动或地址不对。在本机启动 <code>pnpm companion</code>，再在 Install &amp; Doctor 中连接。</dd>
        <dt>“Control plane offline” 但 companion online</dt>
        <dd>companion 进程正常，但 core/control-plane 还没启动。进入 Install &amp; Doctor 检查构建产物和 core 状态。</dd>
        <dt>“Broker offline”</dt>
        <dd>sandbox broker 服务未启动或 socket 路径不一致；任务和设置页面仍可用，sandbox 功能降级。</dd>
        <dt>浏览器拒绝 localhost 连接</dt>
        <dd>确认 companion 正在运行，且页面是受支持的 origin；companion 只接受显式允许的浏览器来源。</dd>
        <dt>更新后页面像旧版</dt>
        <dd>service worker 可能缓存旧资源。强制刷新，或在 DevTools → Application → Service Workers 中 unregister 后重新加载。</dd>
      </dl>
    </article>

    <article class="card">
      <h2>相关入口</h2>
      <p><a :href="REPO_URL" target="_blank" rel="noreferrer">GitHub 仓库</a></p>
      <p><a :href="`${REPO_URL}/blob/main/docs/COMPANION-CORE-CONTRACT.md`" target="_blank" rel="noreferrer">Companion ↔ Core 契约</a></p>
      <p><a :href="`${REPO_URL}/blob/main/docs/ENVIRONMENT-BOOTSTRAP.md`" target="_blank" rel="noreferrer">环境检查与安装边界</a></p>
      <p><a :href="`${REPO_URL}/blob/main/docs/ADR-0002-no-root-privilege-policy.md`" target="_blank" rel="noreferrer">无 root 权限策略</a></p>
    </article>
  </div>
</template>

<style scoped>
.help-page { display: grid; gap: 16px; max-width: 1100px; }
.help-hero { background: linear-gradient(135deg, #0c4a6e55, #0f172acc); }
.version-row { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 18px; color: #64748b; font-size: 12px; }
.version-row b { color: #bae6fd; }
.help-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.help-page h2 { font-size: 20px; }
.help-page h3 { margin: 0 0 8px; }
.help-page p, .help-page li, .help-page dd { color: #94a3b8; line-height: 1.7; }
.help-page dl { display: grid; gap: 10px; }
.help-page dt { color: #e2e8f0; font-weight: 700; }
.help-page dd { margin: 0; }
.help-page ul { padding-left: 20px; margin: 0; }
.help-page a { color: #38bdf8; }
.policy-help { border-color: #854d0e; background: #42200655; }
.policy-help p { color: #fde68a; }
@media (max-width: 860px) { .help-grid { grid-template-columns: 1fr; } }
</style>
