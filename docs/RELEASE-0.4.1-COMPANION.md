# SHE companion 0.4.1 发布说明

> Release：`v0.4.1-companion.1`
> 日期：2026-11-26

## 修复

- 外部 Core 接管增加 Linux fallback：
  - 首选 `/v1/admin/shutdown`；
  - 旧 Core 不支持 admin shutdown 时，读取 `/proc/net/unix` 找到 control socket inode；
  - 扫描 `/proc/<pid>/fd` 找到持有 socket 的进程；
  - 仅允许 UID 匹配当前用户且命令行包含 SHE control-plane/run-core 的进程；
  - 先 SIGTERM，超时后 SIGKILL；
  - 等待 socket 消失后由新 companion 重启 Core。
- 外部 Core warning 文案补充 fallback 行为。

## 使用

已有 0.4.x supervisor 用户可在 Settings 中升级到 0.4.1。升级后再点击停止/重启，旧 Core 即使没有 admin shutdown 接口也会被安全回收。
