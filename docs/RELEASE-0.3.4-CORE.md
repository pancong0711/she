# SHE core 0.3.4 发布说明

> Release：`v0.3.4-core.1`
> 日期：2026-11-27

## 变更

- Core release manifest 增加稳定 channel 下载地址：
  - primary：GitHub Pages bundle
  - fallback：GitHub Release bundle
- bundle 内容与 0.3.3 一致，包含 SHE_HOME 路径、gateway.v1 直接消息与 broker
  SHE_HOME 数据目录；
- 该版本用于配套 companion 0.7.13 的 Pages-first core 更新通道。

## 验证

```text
tsc -b                         ✓
Vitest                         ✓ 39 files / 132 tests
core bundle build              ✓
```
