<script setup lang="ts">
import { COMPANION_BUNDLE_URL, COMPANION_INSTALLER_URL, COMPANION_MANIFEST_URL, COMPANION_RELEASE_URL, REPO_URL } from '../api'

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
        <dd>不请求 root，只在当前用户目录准备 pnpm 等无需管理员权限的组件；不会安装 Docker。若 Docker 缺失，job 仍可能成功，但 Sandbox / Agent Migration / broker 容器能力会标记为不可用，并显示安装指引。</dd>
        <dt>Companion 生命周期</dt>
        <dd>Settings 显示 companion 版本、最低版本和 supervisor 状态。通过 start.sh 启动时可在页面内重启、停止、检查更新和安装并重启；更新使用 checksum，supervisor 在新进程启动失败时回滚。</dd>
        <dt>Core 首次安装</dt>
        <dd>Companion 本身不含 Core。Core 未安装时，Dashboard、Install &amp; Doctor 和 Packages 会显示“安装 Core”按钮；首次安装后 control-plane 与 broker 才能启动。</dd>
        <dt>开发者工具</dt>
        <dd>“安装源码依赖 / 构建 PWA 前端 / 构建 TypeScript 包 / 运行测试”只在 SHE 源码仓库开发调试时使用；正常安装用户不需要执行。安装版 companion 不包含完整源码目录。</dd>
      </dl>
      <p class="muted">
        检查结果中的 <code>ok</code> 表示通过，<code>warn</code> 表示允许继续但功能可能降级，
        <code>fail</code> 表示安装会被阻断。
      </p>
    </article>

    <article class="card">
      <h2>Core 运行时与更新</h2>
      <p>
        PWA 的可视化壳可以长期稳定，core（control-plane + broker）通过版本化 bundle 更新。
        Install &amp; Doctor 会显示 current/previous 版本、supervisor 状态、control/broker
        reachability 和最近一次更新状态。
      </p>
      <ul>
        <li>更新前先下载 bundle，并校验 manifest 中的 SHA-256；</li>
        <li>下载到 staging，不覆盖正在运行的 core；</li>
        <li>停止旧 core，切换 current，启动新 core；</li>
        <li>检查 control-plane 和 broker health；</li>
        <li>失败自动切回 previous 并启动旧 core；</li>
        <li>全过程显示在实时日志面板。</li>
      </ul>
      <p class="muted">
        更新只写入当前用户目录；不执行 sudo，不请求 root。companion 自身的升级是独立边界，
        不会由 PWA 在运行中替换。
      </p>
    </article>

    <article class="card">
      <h2>Companion 自身升级</h2>
      <p>
        companion 是稳定层，不由 core 更新流程或 PWA 在运行中替换。升级 companion 时，
        用户需要下载新的 checksum-verified companion bundle，并用新版安装器安装到用户目录。
      </p>
      <p>
        安装器不请求 root、不安装 Node/Docker、不修改系统服务；旧版本目录可保留用于回滚。
      </p>
      <p>
        <a href="./start.bat" download>Windows start.bat</a> ·
        <a href="./start.command" download>macOS start.command</a> ·
        <a href="./start.sh" download>macOS/Linux start.sh</a>
      </p>
      <p>
        高级入口：
        <a :href="COMPANION_INSTALLER_URL" target="_blank" rel="noreferrer">安装脚本</a> ·
        <a :href="COMPANION_BUNDLE_URL" target="_blank" rel="noreferrer">Companion bundle</a> ·
        <a :href="COMPANION_MANIFEST_URL" target="_blank" rel="noreferrer">SHA/manifest</a> ·
        <a :href="COMPANION_RELEASE_URL" target="_blank" rel="noreferrer">Release</a>
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
      <h2>Agent Migration</h2>
      <p>
        Agent Migration 页面扫描本机已知 AI agent 的进程元数据、cwd、监听端口和配置目录是否存在，
        不读取凭据内容，也不停止原进程。用户可以勾选服务，选择新建空 workspace 或复用原目录，
        并可把原目录只读挂载到 <code>/legacy</code>、把显式勾选的配置目录只读挂载到容器 home。
      </p>
      <p>
        计划会阻断根目录、用户 home 本身和受保护系统路径；执行时通过 broker 创建隔离 sandbox，
        原服务保持运行。镜像必须由用户确认包含对应 agent runtime；SHE 不会猜测安装命令。
      </p>

      <h2>Agent Chat 与 Worker</h2>
      <p>
        Chat 页面通过 control plane 的 `/she submit` 入队任务。要真正执行，需要以
        `SHE_WORKER_ENABLED=1` 启动 control plane，并配置 OpenCode URL、凭据文件和工作区。
        如果 worker 未启用，任务会保持 queued，页面会明确显示。
      </p>
      <p>
        agent 输出通过 `task.agent_event → gateway event → /v1/events` 实时返回。
        Chat 不是第二状态源；它与 CLI、飞书 gateway 共用同一个 control plane。
      </p>

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
          <tr><td>Tasks</td><td>只读 task snapshot；Chat 提交后的任务也在这里显示。</td></tr>
          <tr><td>Agents</td><td>OpenCode health、worker 状态、workspace 只读授权视图；凭据只显示文件路径。</td></tr>
          <tr><td>Workspaces</td><td>叶子目录授权注册表；记录 read-only/read-write 意图，拒绝 root/home/系统路径；实际挂载由 broker 二次校验。</td></tr>
          <tr><td>Chat</td><td>通过 `/she submit` 布置任务，实时显示 agent text delta、工具状态和完成/失败。</td></tr>
          <tr><td>Agent Migration</td><td>发现本机 AI agent，dry-run 规划并迁移到 sandbox；只读凭据目录挂载，原进程不动。</td></tr>
          <tr><td>Sandboxes</td><td>broker 列表、状态、角色、image、按需 CPU/内存/PIDs。</td></tr>
          <tr><td>Packages</td><td>Companion/Core/Node/pnpm/git/bash/curl/tar/SHA-256/Docker/OpenCode 依赖清单；显示用途、缺失影响、可复制安装方法和官方文档链接。</td></tr>
          <tr><td>Gateway</td><td>control-plane gateway.v1 状态、feishu4dsh loopback health URL 与连接状态；飞书 secret 始终留在 feishu4dsh。</td></tr>
          <tr><td>Settings</td><td>companion URL、服务状态、worker/OpenCode/workspace 配置（密码仅保存路径）。</td></tr>
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
      <p><a :href="`${REPO_URL}/blob/main/docs/AGENT-MIGRATION.md`" target="_blank" rel="noreferrer">AI Agent 发现与容器化迁移</a></p>
      <p><a :href="`${REPO_URL}/blob/main/docs/PLATFORM-SUPPORT.md`" target="_blank" rel="noreferrer">平台能力与支持矩阵</a></p>
      <p><a :href="`${REPO_URL}/blob/main/docs/WORKSPACES.md`" target="_blank" rel="noreferrer">Workspace 授权与叶子目录策略</a></p>
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
